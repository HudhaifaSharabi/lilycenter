# Copyright (c) 2024, hudhifa and contributors
# For license information, please see license.txt

# import frappe
from frappe.model.document import Document
import frappe
from frappe import _
from frappe.utils import nowdate, get_time, getdate, today
from datetime import date, datetime, timedelta

class Booking(Document):
    def on_submit(self):
        self.process_payments()
    def validate(self):
        # Validate booking date is not in the past
        if self.booking_date:
            booking_date = getdate(self.booking_date)
            today = date.today()
            
            if booking_date < today:
                frappe.throw(_("لا يمكن حجز موعد في تاريخ سابق لليوم الحالي"))  # رسالة خطأ بالعربي
    
        # Calculate total amount from services
        total_amount = 0
        for service in self.services:
            service_discount = service.price * (service.discount_rate / 100) if service.discount_rate else 0
            amount = service.price - service_discount
            total_amount += amount
        # Calculate total payments
        total_payments = sum(payment.amount for payment in self.payments) if self.payments else 0
        
        # Validate total payments against total amount
        if total_payments > total_amount:
            frappe.throw(_("مجموع المدفوعات ({0}) لا يمكن أن يكون أكبر من المبلغ المستحق ({1})").format(
                total_payments, total_amount
            ))

    def process_payments(self):
        if self.payments:
            # Fetch the cost_center from Lilycenter Setting
            cost_center = frappe.db.get_single_value('Lilycenter Setting', 'cost_center')
            for row in self.payments:
                # Check if payment mode is bank-related and validate reference details
                payment_type = frappe.get_value('Mode of Payment', row.mode_of_payment, 'type')
                if payment_type == 'Bank':
                    if not row.reference_no or not row.reference_date:
                        frappe.throw(_('Reference No and Reference Date are mandatory for Bank transactions'))

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
                })
                payment_entry.insert()
                payment_entry.submit()
        else:
            frappe.throw('يرجى تحديد المدفوعات قبل تقديم الطلب.')

@frappe.whitelist()
def get_bookings_by_date(date=None):
    if not date:
        date = frappe.utils.nowdate()  # Default to today's date if not provided

    # Fetch bookings from the database
    bookings = frappe.db.sql("""
        SELECT 
            rs.time AS service_time,
            i.item_group AS category,
            b.customer,
            (SELECT employee_name FROM `tabEmployee` WHERE name = rs.worker) AS worker_name,
            rs.service_name
        FROM `tabBooking` b
        JOIN `tabReception Service` rs ON rs.parent = b.name
        JOIN `tabItem` i ON i.name = rs.service_name
        WHERE b.booking_date = %(date)s
        AND b.booking_status != 'ملغي'
        ORDER BY rs.time ASC
    """, {"date": date}, as_dict=True)


    # Fetch Reception Form Form from the database
    receptions = frappe.db.sql("""
        SELECT 
            rs.time AS service_time,
            i.item_group AS category,
            b.customer,
            (SELECT employee_name FROM `tabEmployee` WHERE name = rs.worker) AS worker_name,
            rs.service_name
        FROM `tabReception Form` b
        JOIN `tabReception Service` rs ON rs.parent = b.name
        JOIN `tabItem` i ON i.name = rs.service_name
        WHERE b.date = %(date)s
        ORDER BY rs.time ASC
    """, {"date": date}, as_dict=True)

    # Fetch all categories in the "Beauty" group (whether or not they have bookings)
    categories = frappe.db.sql("""
        SELECT name, parent_item_group 
        FROM `tabItem Group`
        WHERE parent_item_group = 'Beauty'
    """, as_dict=True)

    # Generate time slots (00:00 - 23:00)
    time_slots = {}
    start_of_day = datetime.strptime('00:00', '%H:%M')
    end_of_day = datetime.strptime('23:00', '%H:%M')
    current_time = start_of_day
    while current_time <= end_of_day:
        time_range = f"{current_time.strftime('%H:%M')} - {(current_time + timedelta(hours=1)).strftime('%H:%M')}"
        time_slots[time_range] = []  # Initialize an empty list for each time range
        current_time += timedelta(hours=1)

        
    booking_time_slots = {f"{hour:02d}:00 - {hour+1:02d}:00": [] for hour in range(24)}
    reception_time_slots = {f"{hour:02d}:00 - {hour+1:02d}:00": [] for hour in range(24)}
    # Organize bookings by time slot
    for booking in bookings:
        service_time = booking["service_time"]
        if isinstance(service_time, timedelta):
            service_time = (datetime.min + service_time).time()

        start_of_hour = datetime.combine(datetime.min, service_time).replace(minute=0, second=0, microsecond=0)
        end_time = start_of_hour + timedelta(hours=1)
        time_range = f"{start_of_hour.strftime('%H:%M')} - {end_time.strftime('%H:%M')}"

        booking_time_slots[time_range].append({
            "category": booking["category"],
            "customer": booking["customer"],
            "worker_name": booking["worker_name"],
            "service_name": booking["service_name"]
        })

    for reception in receptions:
        service_time = reception["service_time"]
        if isinstance(service_time, timedelta):
            service_time = (datetime.min + service_time).time()

        start_of_hour = datetime.combine(datetime.min, service_time).replace(minute=0, second=0, microsecond=0)
        end_time = start_of_hour + timedelta(hours=1)
        time_range = f"{start_of_hour.strftime('%H:%M')} - {end_time.strftime('%H:%M')}"

        reception_time_slots[time_range].append({
            "category": reception["category"],
            "customer": reception["customer"],
            "worker_name": reception["worker_name"],
            "service_name": reception["service_name"]
        })



        

    # Return all the necessary columns and data
    return {
    "columns": [{"label": "الوقت", "fieldname": "time_range", "fieldtype": "Data", "width": 150}] +
               [{"label": category["name"], "fieldname": category["name"], "fieldtype": "Data", "width": 150} for category in categories],
    
    "data": [ {
        "time_range": time_range,
        "category": booking["category"],
        "customer": booking["customer"],
        "worker_name": booking["worker_name"],
        "service_name": booking["service_name"]
    } for time_range, bookings in booking_time_slots.items() for booking in bookings],

    "receptions": [ {
        "time_range": time_range,
        "category": reception["category"],
        "customer": reception["customer"],
        "worker_name": reception["worker_name"],
        "service_name": reception["service_name"]
    } for time_range, receptions in reception_time_slots.items() for reception in receptions]
}


# def get_bookings_by_date(date=None):
#     if not date:
#         date = frappe.utils.nowdate()  # Default to today's date if not provided

#     # Fetch bookings
#     bookings = frappe.db.sql("""
#         SELECT 
#             rs.time AS service_time,
#             i.item_group AS category,
#             b.customer,
#             (SELECT employee_name FROM `tabEmployee` WHERE name = rs.worker) AS worker_name,
#             rs.service_name
#         FROM `tabBooking` b
#         JOIN `tabReception Service` rs ON rs.parent = b.name
#         JOIN `tabItem` i ON i.name = rs.service_name
#         WHERE b.booking_date = %(date)s
#         AND b.booking_status != 'ملغي'
#         ORDER BY rs.time ASC
#     """, {"date": date}, as_dict=True)

#     # Fetch reception data
#     receptions = frappe.db.sql("""
#         SELECT 
#             rs.time AS reception_time,
#             i.item_group AS category,
#             re.customer,
#             (SELECT employee_name FROM `tabEmployee` WHERE name = rs.worker) AS worker_name,
#             rs.service_name
#         FROM `tabReception Form` re
#         JOIN `tabReception Service` rs ON rs.parent = re.name
#         JOIN `tabItem` i ON i.name = rs.service_name
#         WHERE re.date = %(date)s
#         ORDER BY rs.time ASC
#     """, {"date": date}, as_dict=True)

#     # Fetch all categories in the "Beauty" group
#     categories = frappe.db.sql("""
#         SELECT name, parent_item_group 
#         FROM `tabItem Group`
#         WHERE parent_item_group = 'Beauty'
#     """, as_dict=True)

#     # Generate time slots (00:00 - 23:00)
#     time_slots = {}
#     start_of_day = datetime.strptime('00:00', '%H:%M')
#     end_of_day = datetime.strptime('23:00', '%H:%M')
#     current_time = start_of_day
#     while current_time <= end_of_day:
#         time_range = f"{current_time.strftime('%H:%M')} - {(current_time + timedelta(hours=1)).strftime('%H:%M')}"
#         time_slots[time_range] = {"bookings": [], "receptions": []}
#         current_time += timedelta(hours=1)

#     # Organize bookings by time slot
#     for booking in bookings:
#         service_time = booking["service_time"]
#         start_of_hour = datetime.combine(datetime.min, service_time).replace(minute=0, second=0, microsecond=0)
#         end_time = start_of_hour + timedelta(hours=1)
#         time_range = f"{start_of_hour.strftime('%H:%M')} - {end_time.strftime('%H:%M')}"
#         time_slots[time_range]["bookings"].append({
#             "category": booking["category"],
#             "customer": booking["customer"],
#             "worker_name": booking["worker_name"],
#             "service_name": booking["service_name"]
#         })

#     # Organize reception data by time slot
#     for reception in receptions:
#         reception_time = reception["reception_time"]
#         start_of_hour = datetime.combine(datetime.min, reception_time).replace(minute=0, second=0, microsecond=0)
#         end_time = start_of_hour + timedelta(hours=1)
#         time_range = f"{start_of_hour.strftime('%H:%M')} - {end_time.strftime('%H:%M')}"
#         time_slots[time_range]["receptions"].append({
#             "category": booking["category"],
#             "customer": booking["customer"],
#             "worker_name": booking["worker_name"],
#             "service_name": booking["service_name"]
#         })

#     # Return structured response
#     return {
#         "columns": [{"label": "الوقت", "fieldname": "time_range", "fieldtype": "Data", "width": 150}] +
#                    [{"label": category["name"], "fieldname": category["name"], "fieldtype": "Data", "width": 150} for category in categories],
#         "data": [
#             {
#                 "time_range": time_range,
#                 "type": "booking",
#                 "category": booking["category"],
#                 "customer": booking["customer"],
#                 "worker_name": booking["worker_name"],
#                 "service_name": booking["service_name"]
#             } for time_range, data in time_slots.items() for booking in data["bookings"]
#         ] + [
#             {
#                 "time_range": time_range,
#                 "type": "reception",
#                 "category": reception["category"],
#                 "customer": reception["customer"],
#                 "worker_name": reception["worker_name"],
#                 "service_name": reception["service_name"]
#             } for time_range, data in time_slots.items() for reception in data["receptions"]
#         ]
#     }
def get_default_paid_to_account(mode_of_payment):
    account = frappe.db.get_value('Mode of Payment Account', 
                                  {'parent': mode_of_payment, 'company': frappe.defaults.get_user_default('company')}, 
                                  'default_account')
    return account or "Default Paid To Account"