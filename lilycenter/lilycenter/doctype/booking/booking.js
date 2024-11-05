// Copyright (c) 2024, hudhifa and contributors
// For license information, please see license.txt

frappe.ui.form.on("Booking", {
 
	refresh(frm) {

	},
	onload: function (frm) {
        // Filter `paid_to` field
        frm.set_query('paid_to', 'payments', function () {
            return {
                filters: {
                    'account_type': ['in', ['Bank', 'Cash']],
                    'is_group': 0
                }
            };
        });

        // Filter `paid_from` field
        frm.set_query('paid_from', 'payments', function () {
            return {
                filters: {
                    'account_type': 'Receivable',
                    'is_group': 0
                }
            };
        });

        frm.fields_dict['services'].grid.get_field('worker').get_query = function(doc, cdt, cdn) {
            let row = locals[cdt][cdn];
            return {
                query: "lilycenter.lilycenter.doctype.reception_form.reception_form.get_employees_by_service",
                filters: {
                    'service_name': row.service_name  // Pass the service name as a filter
                }
            };
        };
        frm.fields_dict['services'].grid.get_field('discount').get_query = function(doc, cdt, cdn) {
            let row = locals[cdt][cdn];
            return {
                query: "lilycenter.lilycenter.doctype.reception_form.reception_form.get_discounts_by_service",
                filters: {
                    'service_name': row.service_name  // Pass the service name as a filter
                }
            };
        };
    },
});

frappe.ui.form.on('Reception Service', {
    service_name: function(frm, cdt, cdn) {
        // When the value of service_name changes, clear the worker field
        let row = locals[cdt][cdn];
        frappe.model.set_value(cdt, cdn, 'employee_account', null);
        frappe.model.set_value(cdt, cdn, 'worker', null);
        frappe.model.set_value(cdt, cdn, 'discount', null);
        frappe.model.set_value(cdt, cdn, 'discount_rate', null);  // Set worker to null when service_name changes
    },

    
    services_add: function(frm, cdt, cdn) {
        calculate_total(frm);
    },
    
    services_remove: function(frm, cdt, cdn) {
        calculate_total(frm);
    },
    
    price: function(frm, cdt, cdn) {
        calculate_total(frm);
    },
    discount_percentage: function(frm, cdt, cdn) {
        calculate_total(frm);
    },
});

frappe.ui.form.on('Reception Payments', {
    mode_of_payment: function(frm, cdt, cdn) {
        let row = locals[cdt][cdn];  // Get the current row in the child table

        // Fetch the mode of payment details
        frappe.db.get_value('Mode of Payment', row.mode_of_payment, 'type', function(value) {
            if (value && value.type === 'Bank') {
                // Make reference_no and reference_date mandatory if mode_of_payment type is 'Bank'
                frappe.model.set_value(cdt, cdn, 'reference_no', '');
                frappe.model.set_value(cdt, cdn, 'reference_date', '');
                
                frappe.meta.get_docfield("Reception Payments", "reference_no", frm.doc.name).reqd = 1;
                frappe.meta.get_docfield("Reception Payments", "reference_date", frm.doc.name).reqd = 1;
                
                frm.refresh_field("payments");  // Refresh the child table to reflect changes
            } else {
                // Make reference_no and reference_date non-mandatory for other modes of payment
                frappe.meta.get_docfield("Reception Payments", "reference_no", frm.doc.name).reqd = 0;
                frappe.meta.get_docfield("Reception Payments", "reference_date", frm.doc.name).reqd = 0;

                frm.refresh_field("payments");
            }
        });
    },

    
    payments_add: function(frm, cdt, cdn) {
        calculate_total_payment(frm);
    },
    
    payments_remove: function(frm, cdt, cdn) {
        calculate_total_payment(frm);
    },
    
    amount: function(frm, cdt, cdn) {
        calculate_total_payment(frm);
    }
});

function calculate_total(frm) {
    let total = 0;

    frm.doc.services.forEach(function(row) {
        if(row.discount_percentage > 0)
            service_discount = row.price * (row.discount_percentage / 100) ;
        else 
            service_discount=0
        amount = row.price - service_discount

        total += amount || 0;
    });
    
    frm.set_value('total', total);
    frm.refresh_field('total');
}

function calculate_total_payment(frm) {
    let total_payment = 0;

    frm.doc.payments.forEach(function(row) {
        total_payment += row.amount || 0;
    }); 
    
    frm.set_value('total_payment', total_payment);
    frm.refresh_field('total_payment');
}
