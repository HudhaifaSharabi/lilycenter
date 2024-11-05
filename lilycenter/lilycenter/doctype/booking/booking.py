# Copyright (c) 2024, hudhifa and contributors
# For license information, please see license.txt

# import frappe
from frappe.model.document import Document
import frappe
from frappe import _

class Booking(Document):
	pass

@frappe.whitelist()
def get_today_bookings():
    today = frappe.utils.nowdate()
    bookings = frappe.get_all('Booking', filters={'booking_date': today}, fields=['customer', 'booking_date'])
    return bookings
