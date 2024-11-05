import frappe
from frappe.utils import nowdate
from frappe.model.document import Document

class ReceptionForm(Document):
    def on_submit(self):
        # Handle material deduction from inventory
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
def get_booking_details(booking_id):
    booking = frappe.get_doc("Booking", booking_id)
    return {
        "customer": booking.customer,
        "services": booking.services,
        "payments": booking.payments
    }