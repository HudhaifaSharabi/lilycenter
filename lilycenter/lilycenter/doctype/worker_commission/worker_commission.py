# import frappe
from frappe.model.document import Document
import frappe
from frappe import _

class WorkerCommission(Document):
    def validate(self):
        # Check if the combination of worker and service_name already exists
        existing = frappe.db.exists(
            'Worker Commission', 
            {
                'worker': self.worker,
                'service_name': self.service_name,
                'name': ['!=', self.name]  # Exclude the current document (if editing)
            }
        )
        
        # If an existing record is found, raise a validation error
        if existing:
            frappe.throw(_('المزيج بين الموظف: {0} والخدمة: {1} موجود بالفعل.').format(self.worker, self.service_name))
