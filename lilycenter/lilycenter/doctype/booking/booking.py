# Copyright (c) 2024, hudhifa and contributors
# For license information, please see license.txt

# import frappe
from frappe.model.document import Document
import frappe
from frappe import _
from frappe.utils import nowdate, get_time, getdate, today
from datetime import date

class Booking(Document):
    def validate(self):
        # Validate booking date is not in the past
        if self.booking_date:
            booking_date = getdate(self.booking_date)
            today = date.today()
            
            if booking_date < today:
                frappe.throw(_("لا يمكن حجز موعد في تاريخ سابق لليوم الحالي"))  # رسالة خطأ بالعربي
        
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
def get_today_bookings():
    today = frappe.utils.nowdate()
    
    # الحصول على جميع الخدمات المحجوزة اليوم مع تفاصيلها وأسماء الموظفين
    bookings = frappe.db.sql("""
        SELECT 
            rs.time as service_time,
            rs.category,
            b.customer,
            (SELECT employee_name FROM `tabEmployee` WHERE name = rs.worker) as worker_name,
            b.booking_status
        FROM `tabBooking` b
        JOIN `tabReception Service` rs ON rs.parent = b.name
        WHERE b.booking_date = %s
        AND b.booking_status != 'ملغي'
        ORDER BY rs.time ASC
    """, today, as_dict=1)
    
    return bookings
