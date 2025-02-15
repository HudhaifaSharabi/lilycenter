// Copyright (c) 2024, hudhifa and contributors
// For license information, please see license.txt

frappe.ui.form.on("Service Discount", {
	refresh: function(frm) {
        frm.fields_dict['service'].get_query = function(doc) {
            return {
                filters: {
                    'status': 'نشط'
                }
            };
        };
    },
});
