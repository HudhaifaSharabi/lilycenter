import frappe
from frappe import _
from frappe.utils import get_datetime, nowdate
from frappe.model.document import Document
from datetime import datetime, timedelta

def get_datetime_with_time(time_str):
    """
    تحويل الوقت إلى كائن datetime مع تاريخ اليوم
    
    Args:
        time_str (str): الوقت (مثال: '14:30:00')
        
    Returns:
        datetime: كائن datetime يجمع بين تاريخ اليوم والوقت
    """
    try:
        if isinstance(time_str, str):
            today = nowdate()
            # التعامل مع تنسيقات الوقت المختلفة
            try:
                time_obj = datetime.strptime(time_str, '%H:%M:%S').time()
            except ValueError:
                time_obj = datetime.strptime(time_str, '%H:%M').time()
            
            return datetime.combine(datetime.strptime(today, '%Y-%m-%d').date(), time_obj)
        return None
    except Exception as e:
        frappe.log_error(f"Error in get_datetime_with_time: {str(e)}")
        return None

class ReceptionForm(Document):
    
    def on_submit(self):
        # Calculate total from services
        total = 0
        for service in self.services:
            service_discount = 0
            if service.type_of_discount == "نسبة" and service.discount_rate > 0:
                service_discount = service.price * (service.discount_rate / 100)
            
            elif service.type_of_discount == "مبلغ":
                service_discount = service.discount_amount
            amount = service.price - service_discount
            total += amount

        # Calculate total booking payments
        total_booking_payments = sum(booking_payment.amount for booking_payment in self.booking_payments)
        
        # Calculate total payments
        total_payments = sum(payment.amount for payment in self.payments)
        
        # Calculate grand total of all payments
        grand_total_payments = total_payments + total_booking_payments
        
        # التحقق من المدفوعات حسب الحالة
        if self.statues == "مؤكد":
            if grand_total_payments != total:
                frappe.throw(
                    _("مجموع الدفعات يجب أن يساوي المبلغ الإجمالي المستحق"),
                    title=_("خطأ في الدفع")
                )
        elif self.statues == "أجل":
            if grand_total_payments >= total:
                frappe.throw(
                    _("في حالة التأجيل، يجب أن يكون المبلغ المدفوع أقل من المبلغ الإجمالي"),
                    title=_("خطأ في الدفع")
                )
            
        # Handle material deduction from inventory
        self.deduct_materials()
        
        # Create Sales Invoice based on services
        self.create_sales_invoice()
        
        # Create Process Payments based on services
        # self.process_payments()
        
        # Add Worker Commissions to Commission Payment
        self.process_worker_commission()

    def deduct_materials(self):
        if not self.materials:
            frappe.throw('يرجى تحديد المواد قبل تقديم الطلب.')
        
        # Prepare a list to batch items in a single Stock Entry
        stock_entry_items = []
        # Fetch the cost_center from Lilycenter Setting
        # Fetch the income_account from Coffee Service
            
        warehouse = frappe.db.get_single_value('Lilycenter Setting', 'warehouse')
        warehouse_account = frappe.db.get_single_value('Lilycenter Setting', 'warehouse_account')

        
        for material in self.materials:
            # Fetch the latest rate from Stock Ledger Entry
            latest_rate = frappe.get_all(
                'Stock Ledger Entry',
                filters={
                    'item_code': material.item_code,
                    'is_cancelled': 0
                },
                fields=['valuation_rate'],
                order_by='posting_date desc, posting_time desc, creation desc',
                limit=1
            )
            rate = latest_rate[0].valuation_rate if latest_rate else 0
            cost_center = frappe.db.get_value(
                'Service', 
                {'service_name': material.service_name}, 
                'cost_center'
            )
            # Add the material to the items list for batch processing
            stock_entry_items.append({
                'item_code': material.item_code,
                'qty': material.quantity,
                'basic_rate': rate,  # Use the latest rate
                's_warehouse': warehouse,
                'cost_center': cost_center,
                'expense_account': warehouse_account
            })
        
        # Create a single Stock Entry for all materials
        if stock_entry_items:
            stock_entry = frappe.get_doc({
                'doctype': 'Stock Entry',
                'stock_entry_type': 'Material Issue',
                'items': stock_entry_items
            })
            stock_entry.insert()
            stock_entry.submit()
    def create_sales_invoice(self):
        """
        Create a Sales Invoice and handle discounts for services.
        """
        items = []  # List to store all items for the Sales Invoice
        total_amount = 0  # Total amount of the invoice
        discount_entries = []  # Accounts for the Journal Entry

        for service in self.services:
            # Get the latest price for the service
            price_list_rate = get_latest_price(service.service_name)
            if not price_list_rate:
                frappe.throw(_("لا يوجد سعر محدد للخدمة {0}").format(service.service_name))

            # تحديد نوع الخصم وحسابه
            service_discount = 0
            if service.type_of_discount == "نسبة" and service.discount_rate > 0:
                service_discount = price_list_rate * (service.discount_rate / 100)
            elif service.type_of_discount == "مبلغ":
                service_discount = service.discount_amount

            net_amount = price_list_rate - service_discount

            # Fetch necessary account details
            income_account = frappe.db.get_value('Service', {'service_name': service.service_name}, 'income_account')
            discount_account = frappe.db.get_value('Service', {'service_name': service.service_name}, 'discount_account')
            cost_center = frappe.db.get_value('Service', {'service_name': service.service_name}, 'cost_center')

            # Add service details to Sales Invoice items
            items.append({
                'item_code': service.service_name,
                'item_name': service.service_name,
                'qty': 1,
                'rate': net_amount,
                'amount': net_amount,
                'income_account': income_account,
                'cost_center': cost_center
            })

            total_amount += net_amount

            # Add discount entries if applicable
            if service_discount > 0:
                discount_entries.append({
                    "account": discount_account,  # Debit the discount account
                    "debit_in_account_currency": service_discount,
                    "party_type": "Customer",
                    "party": self.customer,
                })
                discount_entries.append({
                    "account": income_account,  # Credit the income account
                    "credit_in_account_currency": service_discount,
                    "party_type": "Customer",
                    "party": self.customer,
                })

        if not items:
            frappe.throw(_("لا توجد خدمات لإنشاء فاتورة مبيعات."))

        # Create and submit the Sales Invoice
        sales_invoice = frappe.get_doc({
            'doctype': 'Sales Invoice',
            'customer': self.customer,
            'posting_date': nowdate(),
            'items': items,
            'total': total_amount,
            'grand_total': total_amount,
            'outstanding_amount': total_amount,
        })
        # Add Reception Form details to user_remark
        reception_name = self.name  # Assuming `self` is the Reception Form document
        sales_invoice.user_remark = f"تم تطبيق الخصومات على فاتورة المبيعات: {sales_invoice.name} بواسطة استمارة الاستقبال: {reception_name}"

        sales_invoice.insert()
        sales_invoice.submit()

        # Create a Journal Entry for the discounts if applicable
        if discount_entries:
            create_discount_journal_entry(sales_invoice, discount_entries, self.name)

        # Process payments for the created Sales Invoice
        self.process_payments(sales_invoice.name)

    def process_payments(self, sales_invoice_name):
        cost_center = frappe.db.get_single_value('Lilycenter Setting', 'cost_center')
        if not self.payments:
            frappe.throw(_('يرجى تحديد المدفوعات قبل تقديم الطلب.'))

        for row in self.payments:
            sales_invoice = frappe.get_doc("Sales Invoice", sales_invoice_name)
            # Check if payment mode is bank-related and validate reference details
            payment_type = frappe.get_value('Mode of Payment', row.mode_of_payment, 'type')
            if payment_type == 'Bank' and (not row.reference_no or not row.reference_date):
                frappe.throw(_('رقم المرجع وتاريخ المرجع إلزاميان للمعاملات المصرفية'))

            # Create Payment Entry
            payment_entry = frappe.get_doc({
                'doctype': 'Payment Entry',
                'payment_type': 'Receive',
                'mode_of_payment': row.mode_of_payment,
                'party_type': 'Customer',
                'party': self.customer,
                'paid_amount': row.amount,
                'received_amount': row.amount,
                'paid_to': get_default_paid_to_account(row.mode_of_payment),
                'reference_no': row.reference_no if payment_type == 'Bank' else None,
                'reference_date': row.reference_date if payment_type == 'Bank' else None,
                'cost_center': cost_center,
                'references': [
                    {
                        'reference_doctype': 'Sales Invoice',
                        'reference_name': sales_invoice_name,
                        'total_amount': sales_invoice.grand_total,  # Ensure total amount is added
                        'outstanding_amount': sales_invoice.outstanding_amount,
                        'allocated_amount': row.amount,
                    }
                ],
            })
            payment_entry.insert()
            payment_entry.submit()
        
    def validate(self):
        # self.validate_time_conflict()
        
        # self._validate_customer()
        # self._validate_status()
        # self._validate_services()
        # self._validate_total()
        # self._validate_payments()
        # self._validate_materials()
        # self._validate_worker_commission()
        

        if self.statues == "مؤكد":
            if not self.payments:
                frappe.throw(
                    _("يجب إضاف طريقة دفع واحدة على الأقل عند تأكيد الحجز"),
                    title=_("خطأ في الدفع")
                )
            
        total = 0
        for service in self.services:
            service_discount = 0
            if service.type_of_discount == "نسبة" and service.discount_rate > 0:
                service_discount = service.price * (service.discount_rate / 100)
            
            elif service.type_of_discount == "مبلغ":
                service_discount = service.discount_amount
            amount = service.price - service_discount
            total += amount

        # Calculate total booking payments
        total_booking_payments = sum(booking_payment.amount for booking_payment in self.booking_payments)
        
        # Calculate total payments
        total_payments = sum(payment.amount for payment in self.payments)
        
        # Calculate grand total of all payments
        grand_total_payments = total_payments + total_booking_payments
        
        # التحقق من المدفوعات حسب الحالة
        if self.statues == "مؤكد":
            if grand_total_payments != total:
                frappe.throw(
                    _("مجموع الدفعات يجب أن يساوي المبلغ الإجمالي المستحق"),
                    title=_("خطأ في الدفع")
                )
        elif self.statues == "أجل":
            if grand_total_payments >= total:
                frappe.throw(
                    _("في حالة التأجيل، يجب أن يكون المبلغ المدفوع أقل من المبلغ الإجمالي"),
                    title=_("خطأ في الدفع")
                )


   
    def process_worker_commission(self):
        for worker_commission in self.worker_commission:
            cost_center = frappe.db.get_value(
                'Service', 
                {'service_name': worker_commission.service_name}, 
                'cost_center'
            )
            commission_account = frappe.db.get_value(
                'Service', 
                {'service_name': worker_commission.service_name}, 
                'commission_account'
            )
            existing_commission_payment = frappe.db.exists(
                'Commission Payment', 
                {
                    'worker': worker_commission.worker,
                    'date': worker_commission.date
                }
            )

            if existing_commission_payment:
                commission_payment_doc = frappe.get_doc('Commission Payment', existing_commission_payment)
                commission_payment_doc.append('commission_payment_details', {
                    'service_name': worker_commission.service_name,
                    'commission_rate': worker_commission.commission_rate,
                    'price_of_service': worker_commission.price_of_service,
                    'worker_salary': worker_commission.worker_salary,
                })
                commission_payment_doc.save()
            else:
                commission_payment_doc = frappe.get_doc({
                    'doctype': 'Commission Payment',
                    'worker': worker_commission.worker,
                    'date': worker_commission.date,
                    'commission_payment_details': [
                        {
                            'service_name': worker_commission.service_name,
                            'commission_rate': worker_commission.commission_rate,
                            'price_of_service': worker_commission.price_of_service,
                            'worker_salary': worker_commission.worker_salary,
                        }
                    ]
                })
                commission_payment_doc.insert()
                commission_payment_doc.save()

            if worker_commission :
                create_commission_journal_entry(commission_payment_doc, self.customer,worker_commission.worker, worker_commission.worker_salary , commission_account ,worker_commission.employee_account ,cost_center , self.name)

        frappe.msgprint('تمت معالجة مدفوعات العمولة بنجاح.')

def create_commission_journal_entry(commission, customer ,worker , commission_amount ,commission_account ,employee_account ,cost_center, reception_form_name):
    # Create a Journal Entry to reflect the discount for each service
    je = frappe.get_doc({
        "doctype": "Journal Entry",
        "posting_date": nowdate(),
        "voucher_type": "Journal Entry",

        "accounts": [
            {
                "account": commission_account,  # Debit the discount account
                "debit_in_account_currency": commission_amount,
                "party_type": "Customer",
                "party": customer,
                'cost_center': cost_center,
            },
            {
                "account": employee_account,  # Credit the Accounts Receivable account
                "credit_in_account_currency": commission_amount,
                "party_type": "Customer",
                "party": customer,
                'cost_center': cost_center,
            }
        ],
        "user_remark": f"تم تطبيق العمولة بمبلغ {commission_amount} للموظف {worker} في نموذج الاستقبال: {reception_form_name}",
    })

    # Insert and submit the Journal Entry
    je.insert()
    je.submit()

def create_discount_journal_entry(sales_invoice, discount_entries, reception_form_name):
    """
    Create a consolidated Journal Entry for all discounts applied in the Sales Invoice.
    
    Args:
        sales_invoice: The Sales Invoice object.
        discount_entries: A list of dictionaries, each containing service-specific discount details:
            - discount_account
            - debit_in_account_currency
            - service_account
            - credit_in_account_currency
    """
    if not discount_entries:
        frappe.throw(_("لا توجد إدخالات خصم لمعالجتها."))

    # Create the Journal Entry
    je = frappe.get_doc({
        "doctype": "Journal Entry",
        "posting_date": sales_invoice.posting_date,
        "voucher_type": "Journal Entry",
        "company": sales_invoice.company,
        "accounts": discount_entries,
        "user_remark": f"تم تطبيق الخصومات على فاتورة المبيعات: {sales_invoice.name} بواسطة استمارة الاستقبال: {reception_form_name}",
    })

    # Insert and submit the Journal Entry
    je.insert()
    je.submit()


def get_default_paid_to_account(mode_of_payment):
    account = frappe.db.get_value('Mode of Payment Account', 
                                  {'parent': mode_of_payment, 'company': frappe.defaults.get_user_default('company')}, 
                                  'default_account')
    return account or "Default Paid To Account"

@frappe.whitelist()
def get_material(condition_value):
    try:
        sql_query = "select * from `tabService Material` where parent = %s"
        data = frappe.db.sql(sql_query, (condition_value,), as_dict=True)
        return data
    except Exception as e:
        frappe.log_error(f"Error in selecting data: {str(e)}")
        return None
@frappe.whitelist()
def get_employees_by_service(doctype, txt, searchfield, start, page_len, filters):
    service_name = filters.get('service_name')
    return frappe.db.sql("""
        SELECT worker, worker_name
        FROM `tabWorker Commission`
        WHERE service_name = %s
    """, (service_name))
@frappe.whitelist()
def get_discounts_by_service(doctype, txt, searchfield, start, page_len, filters):
    service_name = filters.get('service_name')
    return frappe.db.sql("""
        SELECT name, discount_name
        FROM `tabService Discount`
        WHERE service = %s and statues = %s
    """, (service_name,"Active"))

@frappe.whitelist()
def get_worker_commission_rate(worker, service_name):
    result = frappe.db.sql("""
        SELECT cd.commission_rate 
        FROM `tabWorker Commission` wc
        JOIN `tabCommission Details` cd ON cd.parent = wc.name
        WHERE wc.worker = %s AND wc.service_name = %s
        ORDER BY cd.effective_date DESC 
        LIMIT 1
    """, (worker, service_name))

    if result:
        return result[0][0]
    else:
        return None

@frappe.whitelist()
def get_bookings(customer=None):
    filters = {}
    if customer:
        filters["customer"] = ["like", f"%{customer}%"]

    bookings = frappe.get_all("Booking", filters=filters, fields=["name", "customer", "booking_date", "booking_status"])
    return bookings
import frappe

@frappe.whitelist()
def get_last_5_bookings(customer):
    if not customer:  # Ensure customer is provided
        frappe.throw("يرجاء اختيار عميل", frappe.MandatoryError)

    filters = {"docstatus": 1, "customer": ["like", f"%{frappe.db.escape(customer)}%"]}

    # Fetch the last 5 submitted bookings
    bookings = frappe.get_all(
        "Booking", 
        filters=filters, 
        fields=["name", "customer", "booking_date", "booking_status"], 
        limit=5, 
        order_by="booking_date desc"
    )
    
    return bookings
@frappe.whitelist()
def check_unique_booking(booking_id=None):
    filters = {}
    if booking_id:
        filters["booking_id"] = ["like", f"%{booking_id}%"]

    # Fetching data from the "Reception Form" doctype
    bookings = frappe.get_all("Reception Form", filters=filters)
    
    # If any data is returned, raise an error
    if bookings:
        frappe.throw(_("تم استقبال هذا الحجز من قبل"))
    
    return "Booking ID is unique."

@frappe.whitelist()
def get_booking_details(booking_id):
    booking = frappe.get_doc("Booking", booking_id)
    return {
        "booking_id": booking.name,
        "customer": booking.customer,
        "services": booking.services,
        "payments": booking.payments
    }

    # def validate_time_conflict(self):
    #     for current_service in self.services:
    #         current_start_time = get_datetime_with_time(current_service.time)
    #         current_end_time = current_start_time + timedelta(minutes=current_service.duration)

    #         for other_service in self.services:
    #             if other_service.name != current_service.name:  # تجنب مقارنة الخمة مع نفسها
    #                 other_start_time = get_datetime_with_time(other_service.time)
    #                 other_end_time = other_start_time + timedelta(minutes=other_service.duration)

    #                 # التحقق من تداخل الأوقات بدون النظر إلى الفئة
    #                 if (current_start_time < other_end_time and current_end_time > other_start_time):
    #                     frappe.throw(
    #                         _("Time conflict detected. Client cannot receive two services at the same time.")
    #                     )


    def _validate_customer(self):
        """Validate customer field"""
        if not self.customer:
            frappe.throw(_("يجب اختيار العميل"))
        
        # Validate customer exists
        if not frappe.db.exists("Customer", self.customer):
            frappe.throw(_("العميل غير موجود في النظام"))

    def _validate_status(self):
        """Validate status field"""
        if not self.statues:
            frappe.throw(_("يجب تحديد حالة الطلب"))
        
        if self.statues not in ["مؤكد", "غير مؤكد"]:
            frappe.throw(_("حالة الطلب غير صحيحة"))

    def _validate_services(self):
        """Validate services table"""
        if not self.services:
            frappe.throw(_("يجب إضافة خدمة واحدة على الأقل"))

        for service in self.services:
            # Required fields validation
            if not service.service_name:
                frappe.throw(_("يجب تحديد اسم الخدمة لجميع الخدمات"))
            
            if not service.worker:
                frappe.throw(_("يجب تحديد الموظف لجميع الخدمات"))
            
            if not service.time:
                frappe.throw(_("يجب تحديد وقت لجميع الخدمات"))
            
            if not service.price or service.price <= 0:
                frappe.throw(_("يجب أن يكون سعر الخدمة أكبر من صفر"))

            # Validate service exists
            if not frappe.db.exists("Item", service.service_name):
                frappe.throw(_("الخدمة {0} غير موجودة في النظام").format(service.service_name))

            # Validate worker exists
            if not frappe.db.exists("Employee", service.worker):
                frappe.throw(_("الموظف {0} غير موجود في النظام").format(service.worker))

            # Validate time format
            try:
                time_obj = get_datetime_with_time(service.time)
                if not time_obj:
                    frappe.throw(_("صيغة الوقت غير صحيحة للخدمة {0}").format(service.service_name))
            except Exception:
                frappe.throw(_("صيغة الوقت غير صحيحة للخدمة {0}").format(service.service_name))

    def _validate_total(self):
        """Validate total amount"""
        calculated_total = sum(service.price for service in self.services)
        if float(self.total) != calculated_total:
            frappe.throw(_("مجموع الخدمات يجب أن يساوي المبلغ الإجمالي المستحق"))

    def _validate_payments(self):
        """Validate payments table"""
        if self.statues == "مؤكد":
            if not self.payments or not self.payments.length:
                frappe.throw(_("يجب إضافة طريقة دفع واحدة على الأقل للحالة المؤكدة"))

            total_payments = 0
            for payment in self.payments:
                if not payment.mode_of_payment:
                    frappe.throw(_("يجب تحديد طريقة الدفع لكل سطر في المدفوعات"))

                if not payment.amount or payment.amount <= 0:
                    frappe.throw(_("يجب أن يكون مبلغ الدفع أكبر من صفر"))

                total_payments += payment.amount

            if total_payments != float(self.total):
                frappe.throw(_("مجموع المدفوعات يجب أن يساوي المبلغ الإجمالي المستحق"))

    def _validate_materials(self):
        """Validate materials table"""
        if not self.materials or not self.materials.length:
            frappe.throw(_("يجب إضافة مادة واحدة على الأقل في جدول المواد"))

        for material in self.materials:
            if not material.item_code:
                frappe.throw(_("يجب تحديد رمز المادة لكل سطر في جدول المواد"))

            if not material.quantity or material.quantity <= 0:
                frappe.throw(_("يجب أن يكون مبلغ المادة أكبر من صفر"))

    def _validate_worker_commission(self):
        """Validate worker commission table"""
        if not self.worker_commission or not self.worker_commission.length:
            frappe.throw(_("يجب إضافة عمولة واحدة على الأقل في جدول العمولة"))

        for worker_commission in self.worker_commission:
            if not worker_commission.worker:
                frappe.throw(_("يجب تحديد الموظف لكل سطر في جدول العمولة"))

            if not worker_commission.service_name:
                frappe.throw(_("يجب تحديد اسم الخدمة لكل سطر في جدول العمولة"))

            if not worker_commission.commission_rate or worker_commission.commission_rate <= 0:
                frappe.throw(_("يجب أن يكون معدل العمولة أكبر من صفر"))

            if not worker_commission.price_of_service or worker_commission.price_of_service <= 0:
                frappe.throw(_("يجب أن يكون سعر الخدمة أكبر من صفر"))

            if not worker_commission.worker_salary or worker_commission.worker_salary <= 0:
                frappe.throw(_("يجب أن يكون مبلغ الموظف أكبر من صفر"))

            if not worker_commission.commission_account:
                frappe.throw(_("يجب تحديد حساب العمولة لكل سطر في جدول العمولة"))

            if not worker_commission.employee_account:
                frappe.throw(_("يجب تحديد حساب الموظف لكل سطر في جدول العمولة"))

    def check_availability(self, category, start_time, duration, current_row_name=None):
        end_time = start_time + timedelta(minutes=duration)
        
        section_capacity = frappe.get_value('Item Group', category, 'section_capacity') or 1
        
        overlapping_services = frappe.db.sql("""
            SELECT rs.name
            FROM `tabReception Service` rs
            JOIN `tabReception Form` rf ON rs.parent = rf.name
            WHERE rf.docstatus < 2
                AND rs.category = %s
                AND rs.name != %s
                AND rf.date = %s
                AND (
                    (TIME(%s) < ADDTIME(rs.time, SEC_TO_TIME(rs.duration * 60))
                    AND ADDTIME(TIME(%s), SEC_TO_TIME(%s * 60)) > rs.time)
                )
        """, (category, current_row_name or '', nowdate(), start_time.time(), 
              start_time.time(), duration), as_dict=1)
        
        return len(overlapping_services) < section_capacity

@frappe.whitelist()
def check_slot_availability(service_name, worker, time, duration, date, exclude_document, customer, request):
    """التحقق من توفر الموعد مع القدرة الاستيعابية وإظهار اسم العميل والتاريخ ورقم الهاتف في رسالة الخطأ"""
    try:
        try:
            if isinstance(duration, str) and ':' in duration:
                hours, minutes = duration.split(':')[:2]
                duration_minutes = (int(hours) * 60) + int(minutes)
            else:
                duration_minutes = int(float(duration))
        except:
            duration_minutes = 60
        # تحقق من البيانات المطلوبة
        if not all([service_name, worker, time, duration, date]):
            return {
                "available": False,
                "error": "بيانات غير مكتملة"
            }

        # تحويل الوقت إلى دقائق
        time_parts = time.split(':')
        requested_start = int(time_parts[0]) * 60 + int(time_parts[1])
        requested_end = requested_start + duration_minutes

        # استعلام للحصول على الحجوزات المتداخلة من جدول "الحجز"
        if request=="reception":
            overlapping_bookings = frappe.db.sql("""
                SELECT 
                    rs.service_name, 
                    rs.worker,
                    rs.time as service_time,
                    b.customer,
                    b.mobile_no,
                    b.booking_date,
                    CASE 
                        WHEN rs.duration REGEXP '^[0-9]+:[0-9]+' THEN 
                            (
                                CAST(SUBSTRING_INDEX(rs.duration, ':', 1) AS UNSIGNED) * 60 +
                                CAST(SUBSTRING_INDEX(rs.duration, ':', -1) AS UNSIGNED)
                            )
                        ELSE CAST(rs.duration AS DECIMAL(10,2))
                    END as duration_minutes
                FROM `tabReception Service` rs
                JOIN `tabBooking` b ON rs.parent = b.name
                WHERE b.docstatus < 2
                    AND rs.worker = %(worker)s
                    AND DATE(b.booking_date ) = %(date)s
                    AND b.name != %(exclude_document)s 
                    AND b.customer != %(customer)s
                    AND b.booking_status != 'ملغي'
            """, {
                'worker': worker,
                'customer': customer,
                'date': date,
                'exclude_document':exclude_document
            }, as_dict=True)
        
       
        elif request=="booking" :
            overlapping_bookings = frappe.db.sql("""
                SELECT 
                    rs.service_name, 
                    rs.worker,
                    rs.time as service_time,
                    b.customer,
                    b.mobile_no,
                    b.booking_date,
                    CASE 
                        WHEN rs.duration REGEXP '^[0-9]+:[0-9]+' THEN 
                            (
                                CAST(SUBSTRING_INDEX(rs.duration, ':', 1) AS UNSIGNED) * 60 +
                                CAST(SUBSTRING_INDEX(rs.duration, ':', -1) AS UNSIGNED)
                            )
                        ELSE CAST(rs.duration AS DECIMAL(10,2))
                    END as duration_minutes
                FROM `tabReception Service` rs
                JOIN `tabBooking` b ON rs.parent = b.name
                WHERE b.docstatus < 2
                    AND rs.worker = %(worker)s
                    AND DATE(b.booking_date ) = %(date)s
                    AND b.name != %(exclude_document)s 
                    AND b.booking_status != 'ملغي'
            """, {
                'worker': worker,
                'date': date,
                'exclude_document':exclude_document
            }, as_dict=True)
       

        # استعلام للحصول على الحجوزات المتداخلة من جدول "الاستقبال"
        overlapping_services = frappe.db.sql("""
            SELECT 
                rs.service_name, 
                rs.worker,
                rs.time as service_time,

                rf.date as reception_date,
                CASE 
                    WHEN rs.duration REGEXP '^[0-9]+:[0-9]+' THEN 
                        (
                            CAST(SUBSTRING_INDEX(rs.duration, ':', 1) AS UNSIGNED) * 60 +
                            CAST(SUBSTRING_INDEX(rs.duration, ':', -1) AS UNSIGNED)
                        )
                    ELSE CAST(rs.duration AS DECIMAL(10,2))
                END as duration_minutes
            FROM `tabReception Service` rs
            JOIN `tabReception Form` rf ON rs.parent = rf.name
            WHERE rf.docstatus < 2
                AND rs.worker = %(worker)s
                AND DATE(rf.date ) = %(date)s
                AND rf.name != %(exclude_document)s

        """, {
            'worker': worker,
            'date': date,
            'exclude_document':exclude_document

        }, as_dict=True)

        # حساب التداخل والقدرة الاستيعابية
        current_overlapping = 0
        overlapping_info = []
        current_service_time= ""
        # التحقق من التداخل في الحجوزات المتداخلة
        for booking in overlapping_bookings:
            service_time_parts = str(booking.service_time).split(':')
            service_start = int(service_time_parts[0]) * 60 + int(service_time_parts[1])
            service_end = service_start + int(booking.duration_minutes)

            # التحقق من التداخل
            if not (requested_end <= service_start or requested_start >= service_end):
                overlapping_duration = service_end - service_start
                if booking.service_name == service_name:
                    current_overlapping += 1
                    current_service_time=booking.service_time
                else:
                    # رفض الحجز إذا كانت الخدمة مختلفة
                    return {
                        "available": False,
                        "error": (
                            f"هناك حجز متداخل لخدمة  {booking.service_name} في هذا الوقت.  "
                            f"العميل: {booking.customer}, التاريخ: {booking.booking_date}, "
                            f"وقت الحجز: {booking.service_time} لمدة {overlapping_duration} دقيقة. "
                            f"الرجاء اختيار وقت آخر."
                        )
                    }

        # التحقق من التداخل في الاستقبال المتداخل
        for service in overlapping_services:
            service_time_parts = str(service.service_time).split(':')
            service_start = int(service_time_parts[0]) * 60 + int(service_time_parts[1])
            service_end = service_start + int(service.duration_minutes)

            # التحقق من التداخل
            if not (requested_end <= service_start or requested_start >= service_end):
                overlapping_duration = service_end - service_start
                if service.service_name == service_name:
                    current_overlapping += 1
                    current_service_time=service.service_time
                else:
                    # رفض الحجز إذا كانت الخدمة مختلفة
                    return {
                        "available": False,
                         "error": (
                            f"""هناك استقبال متداخل لهذا الموظف  بخدمة: {service.service_name}  في هذا الوقت. ,
                            وقت الاستقبال: {service.service_time}, التاريخ: {service.reception_date},
                            ومده هذا الخدمة: {overlapping_duration} دقيقة. 
                            الرجاء اختيار وقت آخر. """
                        )
                    }

        # جلب القدرة الاستيعابية للخدمة
        section_capacity = frappe.get_value('Worker Commission', 
            {'worker': worker, 'service_name': service_name}, 
            'section_capacity') or 1

        is_available = current_overlapping < section_capacity

        return {
            "available": is_available,
            "overlapping_count": current_overlapping,
            "section_capacity": section_capacity,
            "current_service_time":current_service_time
        }

    except Exception as e:
        frappe.logger().error(f"Slot Check Error: {str(e)}")
        return {
            "available": False,
            "error": str(e)
        }


    def before_submit(self):
        if self.statues != "مؤكد":
            frappe.throw(
                _("يجب عليك تأكيد الحجز قبل الإرسال"),
                title=_("تنبيه")
            )
        
        total = 0
        for service in self.services:
            service_discount = 0
            if service.type_of_discount == "نسبة" and service.discount_rate > 0:
                service_discount = service.price * (service.discount_rate / 100)
            
            elif service.type_of_discount == "مبلغ":
                service_discount = service.discount_amount
            amount = service.price - service_discount
            total += amount

        # Calculate total booking payments
        total_booking_payments = sum(booking_payment.amount for booking_payment in self.booking_payments)
        
        # Calculate total payments
        total_payments = sum(payment.amount for payment in self.payments)
        
        # Calculate grand total of all payments
        grand_total_payments = total_payments + total_booking_payments
        
        # التحقق من المدفوعات حسب الحالة
        if self.statues == "مؤكد":
            if grand_total_payments != total:
                frappe.throw(
                    _("مجموع الدفعات يجب أن يساوي المبلغ الإجمالي المستحق"),
                    title=_("خطأ في الدفع")
                )
        elif self.statues == "أجل":
            if grand_total_payments >= total:
                frappe.throw(
                    _("في حالة التأجيل، يجب أن يكون المبلغ المدفوع أقل من المبلغ الإجمالي"),
                    title=_("خطأ في الدفع")
                )

    def get_indicator(self):
        """Return indicator color for the document"""
        if self.statues != "مؤكد":
            return [_("غير مؤكد"), "red", "statues,!=,مؤكد"]
        return [_("مؤكد"), "green", "statues,=,مؤكد"]

    def get_list_settings(self):
        return {
            'order_by': 'CASE WHEN statues != "مؤكد" THEN 0 ELSE 1 END, modified DESC'
        }

# Main ways ERPNext gets item rates
def get_item_rate():
    # 1. Item Price List
    rate = frappe.get_value('Item Price', 
        {'item_code': item_code, 'price_list': price_list}, 
        'price_list_rate')
    
    # 2. Item Default Rate
    if not rate:
        rate = frappe.get_value('Item', item_code, 'standard_rate')
    
    # 3. Last Purchase Rate
    if not rate:
        rate = frappe.get_value('Item', item_code, 'last_purchase_rate')

@frappe.whitelist()
def get_latest_price(item_code):
    latest_price = frappe.get_all(
        'Item Price',
        filters={
            'item_code': item_code,
            'selling': 1  # للتأكد من أنه سعر بيع
        },
        fields=['price_list_rate'],
        order_by='valid_from desc, modified desc',  # ترتيب حسب تاريخ السريان ثم تاريخ التعديل
        limit=1
    )
    return latest_price[0].price_list_rate if latest_price else None

@frappe.whitelist()
def get_latest_stock_rate(item_code):
    latest_rate = frappe.get_all(
        'Stock Ledger Entry',
        filters={
            'item_code': item_code,
            'is_cancelled': 0
        },
        fields=['valuation_rate'],
        order_by='posting_date desc, posting_time desc, creation desc',
        limit=1
    )
    return latest_rate[0].valuation_rate if latest_rate else 0












    