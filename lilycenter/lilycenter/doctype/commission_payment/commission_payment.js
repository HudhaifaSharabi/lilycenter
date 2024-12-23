// Copyright (c) 2024, hudhifa and contributors
// For license information, please see license.txt

frappe.ui.form.on("Commission Payment", {
	refresh(frm) {
        calculate_total(frm)
	},
});

frappe.ui.form.on('Commission Payment Details', {
    service_name: function(frm, cdt, cdn) {
        let row = locals[cdt][cdn];
        if (!row.service_name) {
            frappe.model.set_value(cdt,cdn,'commission_rate',null)
            frappe.model.set_value(cdt,cdn,'worker_salary',null)
            frappe.throw(__('يجب تحديد  خدمة'));
        }else{
            calculate_commission(cdt,cdn);
        }

        // Bank payment validation

    },

    commission_rate: function(frm, cdt, cdn) {
        let row = locals[cdt][cdn];
        if (!row.commission_rate || row.commission_rate > 100 || row.commission_rate <= 0  ) {
                frappe.model.set_value(cdt,cdn,'commission_rate',null)
                frappe.model.set_value(cdt,cdn,'worker_salary','')
            frappe.throw(__('يجب أن يكون نسبة العمولة أقل من 100 وأكبر من 0'));
        }
        else{
            calculate_commission(cdt,cdn);
        }
    }
});
function calculate_commission(cdt,cdn) {
    let row = locals[cdt][cdn];
    let commission =(row.price_of_service* row .commission_rate)/100;
    frappe.model.set_value(cdt,cdn,'worker_salary',commission)
}
function calculate_total(frm) {
    let total= 0;
    if (frm.doc.commission_payment_details && frm.doc.commission_payment_details.length) {
        frm.doc.commission_payment_details.forEach(function(row) {
            total += row.worker_salary || 0;
        }); 
    }
    frm.set_value('total', total);
    frm.refresh_field('total');
}