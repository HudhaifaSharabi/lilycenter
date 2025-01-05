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

@frappe.whitelist()
def check_slot_availability(category=None, time=None, duration=None, booking_date=None):
    """التحقق من توفر الموعد"""
    try:
        if not all([category, time, duration, booking_date]):
            return {
                "available": False,
                "error": "بيانات غير مكتملة"
            }

        # تحويل المدة إلى دقائق
        try:
            if isinstance(duration, str) and ':' in duration:
                hours, minutes = duration.split(':')[:2]
                duration_minutes = (int(hours) * 60) + int(minutes)
            else:
                duration_minutes = int(float(duration))
        except:
            duration_minutes = 60  # القيمة الافتراضية

        # البحث عن الخدمات المتداخلة
        overlapping_services = frappe.db.sql("""
            SELECT 
                rs.time as service_time,
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
                AND rs.category = %(category)s
                AND b.booking_date = %(booking_date)s
                AND b.booking_status != 'ملغي'
        """, {
            'category': category,
            'booking_date': booking_date
        }, as_dict=1)

        # حساب التداخل
        current_overlapping = 0
        time_parts = time.split(':')
        requested_minutes = int(time_parts[0]) * 60 + int(time_parts[1])
        requested_end_minutes = requested_minutes + duration_minutes

        for service in overlapping_services:
            service_time_parts = str(service.service_time).split(':')
            service_minutes = int(service_time_parts[0]) * 60 + int(service_time_parts[1])
            service_end_minutes = service_minutes + int(service.duration_minutes)

            # التحقق من التداخل
            if not (requested_end_minutes <= service_minutes or 
                   requested_minutes >= service_end_minutes):
                current_overlapping += 1

        # الحصول على سعة القسم
        section_capacity = frappe.get_value('Item Group', category, 'section_capacity') or 1

        # تحضير معلومات التشخيص
        debug_info = {
            "category": category,
            "time": time,
            "duration": duration_minutes,
            "booking_date": booking_date,
            "section_capacity": section_capacity,
            "overlapping_count": current_overlapping,
            "existing_services": [
                {
                    "time": str(s.service_time),
                    "duration": int(s.duration_minutes)
                } for s in overlapping_services
            ]
        }

        # تسجيل المعلومات في ملف السجل
        frappe.logger().debug(f"Availability Check: {debug_info}")

        is_available = current_overlapping < section_capacity

        return {
            "available": is_available,
            "debug_info": debug_info
        }

    except Exception as e:
        frappe.logger().error(f"Slot Check Error: {str(e)}")
        return {
            "available": False,
            "error": str(e)
        }
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

    # Organize bookings by time slot
    for booking in bookings:
        service_time = booking["service_time"]
        if isinstance(service_time, timedelta):
            service_time = (datetime.min + service_time).time()

        start_of_hour = datetime.combine(datetime.min, service_time).replace(minute=0, second=0, microsecond=0)
        end_time = start_of_hour + timedelta(hours=1)
        time_range = f"{start_of_hour.strftime('%H:%M')} - {end_time.strftime('%H:%M')}"

        time_slots[time_range].append({
            "category": booking["category"],
            "customer": booking["customer"],
            "worker_name": booking["worker_name"],
            "service_name": booking["service_name"]
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
        } for time_range, bookings in time_slots.items() for booking in bookings]
    }
def get_default_paid_to_account(mode_of_payment):
    account = frappe.db.get_value('Mode of Payment Account', 
                                  {'parent': mode_of_payment, 'company': frappe.defaults.get_user_default('company')}, 
                                  'default_account')
    return account or "Default Paid To Account"