// Copyright (c) 2024, hudhifa and contributors
// For license information, please see license.txt
frappe.ui.form.on('Commission Details', {
    commission_add: function(frm, cdt, cdn) {
        var row = locals[cdt][cdn];
        // Check if the effective_date field is empty before setting the default value
        if (!row.effective_date) {
            // Set the current date and time as the default value for effective_date
            frappe.model.set_value(cdt, cdn, 'effective_date', frappe.datetime.now_datetime());
        }
        if (!row.commission_rate || row.commission_rate > 100 || row.commission_rate <= 0  ) {
            frappe.model.set_value(cdt,cdn,'commission_rate',null)
            frappe.throw(__('يجب أن يكون نسبة العمولة أقل من 100 وأكبر من 0' ));
        }
    }
});
