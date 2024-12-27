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
            service_discount = service.price * (service.discount_rate / 100) if service.discount_rate else 0
            amount = service.price - service_discount
            total += amount

        # Calculate total booking payments
        total_booking_payment=0
        
        total_booking_payment = sum(booking_payment.amount for booking_payment in self.booking_payments)
        # Calculate total payments
        total_payments=0
        total_payments = (sum(payment.amount for payment in self.payments)+total_booking_payment)
        
        if total_payments != total:
            frappe.throw(
                _("مجموع الدفعات يجب أن يساوي المبلغ الإجمالي المستحق"),
                title=_("خطأ في الدفع")
            )        # Handle material deduction from inventory
        self.deduct_materials()
        #Create Sales Invoice based on services
        self.create_sales_invoice()
        
        # Create Process Payments based on services
        self.process_payments()
        


        # Add Worker Commissions to Commission Payment
        self.process_worker_commission()

        
            
            
    def deduct_materials(self):
        if self.materials:
            for material in self.materials:
                stock_entry = frappe.get_doc({
                    'doctype': 'Stock Entry',
                    'stock_entry_type': 'Material Issue',
                    'items': [
                        {
                            'item_code': material.item_code,
                            'qty': material.quantity,
                            's_warehouse': 'مخازن - L'
                        }
                    ]
                })
                stock_entry.insert()
                stock_entry.submit()
        else:
            frappe.throw('يرجى تحديد المواد قبل تقديم الطلب.')

    def create_sales_invoice(self):
    # Loop through each service and create a separate sales invoice for each one
        for service in self.services:
            # Calculate discount for the current service
            service_discount = service.price * (service.discount_rate / 100) if service.discount_rate else 0
            amount = service.price - service_discount  # Final amount after discount

            # Prepare the item data for the service
            items = [{
                'item_code': service.service_name,
                'item_name': service.service_name,
                'qty': 1,
                'rate': amount,
                'amount': amount,
                'income_account': service.income_account # Price after discount
            }]

            # Create Sales Invoice for the current service
            sales_invoice = frappe.get_doc({
                'doctype': 'Sales Invoice',
                'customer': self.customer,
                'posting_date': nowdate(),
                'items': items,
                'total': amount,  # Total amount for this service
                'grand_total': amount,
                'outstanding_amount': amount,
            })

            # Insert and submit the Sales Invoice
            sales_invoice.insert()
            sales_invoice.submit()

            # If there's a discount, create a journal entry for it
            if service_discount > 0:
                create_discount_journal_entry(sales_invoice, service.service_name, service_discount , service.income_account ,service.discount_account)



    def process_payments(self):
        if self.payments:
            for row in self.payments:
                payment_entry = frappe.get_doc({
                    'doctype': 'Payment Entry',
                    'payment_type': 'Receive',
                    'mode_of_payment': row.mode_of_payment,
                    'party_type': 'Customer',
                    'party': self.customer,
                    'paid_amount': row.amount,
                    'received_amount': row.amount,
                    'paid_to': get_default_paid_to_account(row.mode_of_payment),
                })
                payment_entry.insert()
                payment_entry.submit()
        else:
            frappe.throw('يرجى تحديد المدفوعات قبل تقديم الطلب.')

    def process_worker_commission(self):
        for worker_commission in self.worker_commission:
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
                create_commission_journal_entry(commission_payment_doc, self.customer,worker_commission.worker, worker_commission.worker_salary , worker_commission.commission_account ,worker_commission.employee_account)

        frappe.msgprint('تمت معالجة مدفوعات العمولة بنجاح.')

def create_commission_journal_entry(commission, customer ,worker , commission_amount ,commission_account ,employee_account):
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
            },
            {
                "account": employee_account,  # Credit the Accounts Receivable account
                "credit_in_account_currency": commission_amount,
                "party_type": "Customer",
                "party": customer,
            }
        ],
        "user_remark": f"Commission of {commission_amount} applied for {worker} ",
    })

    # Insert and submit the Journal Entry
    je.insert()
    je.submit()

def create_discount_journal_entry(sales_invoice, service_name, discount_amount , service_account ,discount_account):

    # Create a Journal Entry to reflect the discount for each service
    je = frappe.get_doc({
        "doctype": "Journal Entry",
        "posting_date": sales_invoice.posting_date,
        "voucher_type": "Journal Entry",
        "company": sales_invoice.company,
        "accounts": [
            {
                "account": discount_account,  # Debit the discount account
                "debit_in_account_currency": discount_amount,
                "party_type": "Customer",
                "party": sales_invoice.customer,
            },
            {
                "account": service_account,  # Credit the Accounts Receivable account
                "credit_in_account_currency": discount_amount,
                "party_type": "Customer",
                "party": sales_invoice.customer,
            }
        ],
        "user_remark": f"Discount of {discount_amount} applied for {service_name} in Sales Invoice: {sales_invoice.name}",
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
@frappe.whitelist()
def get_last_5_bookings(customer=None):
    filters = {}
    if customer:
        filters["customer"] = ["like", f"%{customer}%"]

    # Fetching the last 5 bookings
    bookings = frappe.get_all("Booking", filters=filters, fields=["name", "customer", "booking_date", "booking_status"], limit=5, order_by="booking_date desc")
    
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

    def validate(self):
        # self.validate_time_conflict()
        
        self._validate_customer()
        self._validate_status()
        self._validate_services()
        self._validate_total()
        self._validate_payments()
        self._validate_materials()
        self._validate_worker_commission()

        if self.statues == "مؤكد":
            if not self.payments:
                frappe.throw(
                    _("يجب إضاف طريقة دفع واحدة على الأقل عند تأكيد الحجز"),
                    title=_("خطأ في الدفع")
                )
            
            # Calculate total from services
            total = 0
            for service in self.services:
                service_discount = service.price * (service.discount_rate / 100) if service.discount_rate else 0
                amount = service.price - service_discount
                total += amount
            # Calculate total booking payments
            total_booking_payment=0
            total_booking_payment = sum(total_booking_payments.amount for total_booking_payment in self.total_booking_payments)
            # Calculate total payments
            total_payments=0
            total_payments = (sum(payment.amount for payment in self.payments)+total_booking_payment)
            
            if total_payments :
                frappe.throw(
                    _("مجموع الدفعات يجب أن يساوي المبلغ الإجمالي المستحق"),
                    title=_("خطأ في الدفع")
                )

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
def check_slot_availability(service_name=None, worker=None, time=None, duration=None, date=None):
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
                AND b.booking_status != 'ملغي'
        """, {
            'worker': worker,
            'date': date
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
        """, {
            'worker': worker,
            'date': date
        }, as_dict=True)

        # حساب التداخل والقدرة الاستيعابية
        current_overlapping = 0
        overlapping_info = []

        # التحقق من التداخل في الحجوزات المتداخلة
        for booking in overlapping_bookings:
            service_time_parts = str(booking.service_time).split(':')
            service_start = int(service_time_parts[0]) * 60 + int(service_time_parts[1])
            service_end = service_start + int(booking.duration_minutes)

            # التحقق من التداخل
            if not (requested_end <= service_start or requested_start >= service_end):
                if booking.service_name == service_name:
                    current_overlapping += 1
                else:
                    # رفض الحجز إذا كانت الخدمة مختلفة
                    return {
                        "available": False,
                        "error": f"هناك حجز متداخل لخدمة مختلفة في هذا الوقت. العميل: {booking.customer}, التاريخ: {booking.booking_date}"
                    }

        # التحقق من التداخل في الاستقبال المتداخل
        for service in overlapping_services:
            service_time_parts = str(service.service_time).split(':')
            service_start = int(service_time_parts[0]) * 60 + int(service_time_parts[1])
            service_end = service_start + int(service.duration_minutes)

            # التحقق من التداخل
            if not (requested_end <= service_start or requested_start >= service_end):
                if service.service_name == service_name:
                    current_overlapping += 1
                else:
                    # رفض الحجز إذا كانت الخدمة مختلفة
                    return {
                        "available": False,
                        "error": f"هناك استقبال متداخل لخدمة مختلفة في هذا الوقت. العميل: {service.customer}, الهاتف: {service.customer}, التاريخ: {service.reception_date}"
                    }

        # جلب القدرة الاستيعابية للخدمة
        section_capacity = frappe.get_value('Worker Commission', 
            {'worker': worker, 'service_name': service_name}, 
            'section_capacity') or 1

        is_available = current_overlapping < section_capacity

        return {
            "available": is_available,
            "overlapping_count": current_overlapping,
            "section_capacity": section_capacity
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
        
        # Calculate total from services
        total = 0
        for service in self.services:
            service_discount = service.price * (service.discount_rate / 100) if service.discount_rate else 0
            amount = service.price - service_discount
            total += amount

        # Calculate total payments
        total_payments = sum(payment.amount for payment in self.payments)

        if total_payments != total:
            frappe.throw(
                _("مجموع الدفعات يجب أن يساوي المبلغ الإجمالي المستحق"),
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