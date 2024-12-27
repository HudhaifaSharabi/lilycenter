# Copyright (c) 2024, hudhifa and contributors
# For license information, please see license.txt



import frappe
from frappe import _
from frappe.model.document import Document


class CommissionPayment(Document):
    def validate(self, method=None):  # Add 'method' parameter here
        """
        Validate method for Commission Payment.
        """
        for row in self.get("commission_payment_details"):
            # Check if the service name is present
            if not row.service_name:
                frappe.throw(_("يجب تحديد خدمة"))

            # Validate commission rate
            if not row.commission_rate or row.commission_rate > 100 or row.commission_rate <= 0:
                frappe.throw(_("يجب أن يكون نسبة العمولة أقل من 100 وأكبر من 0"))

            # Calculate commission
            self.calculate_commission(row)

    def calculate_commission(self, row):
        """
        Calculate the worker's salary based on the price of the service and commission rate.
        """
        if row.price_of_service and row.commission_rate:
            row.worker_salary = (row.price_of_service * row.commission_rate) / 100
        else:
            row.worker_salary = 0
