// Copyright (c) 2024, hudhifa and contributors
// For license information, please see license.txt

frappe.ui.form.on("Booking", {
 
	refresh(frm) {
        frm.add_custom_button(__('الاستقبال'), function() {
            // Route to the Reception Form with the current booking ID
            frappe.set_route('Form', 'Reception Form', {
                // booking_id: frm.doc.name,      // Pass current booking's ID
                // customer: frm.doc.customer     // Pass customer information
            });
            });
	},
    booking_date: function(frm) {
        // Get today's date
        let today = frappe.datetime.get_today();
        let selected_date = frm.doc.booking_date;

        // Compare dates
        if (selected_date < today) {
            frappe.msgprint(__('لا يمكن اختيار تاريخ قبل اليوم')); // رسالة خطأ بالعربي
            frm.set_value('booking_date', today);
        }
    },
	onload: function (frm) {
        // Add date validation
        
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
    time: function(frm, cdt, cdn) {
        let current_row = locals[cdt][cdn];
        // Check for duplicate time in the same category
        let duplicate_found = frm.doc.services.some(row => {
            // Exclude current row from check
            if (row.name !== current_row.name) {
                let start_time = convertToDateTime(row.time);
                let end_time = getEndTime(start_time, row.duration);
    
                let current_start_time = convertToDateTime(current_row.time);
                let current_end_time = getEndTime(current_start_time, current_row.duration);
    
                // تحقق من التداخل بين الخدمة الحالية والخدمات الأخرى بغض النظر عن الفئة
                return (current_start_time < end_time && current_end_time > start_time);
            }
            return false;
        });
    
        if (duplicate_found) {
            frappe.msgprint({
                title: __('تعارض في المواعيد'),
                message: __('لا يمكن للعميل تلقي خدمتين في نفس الوقت. الرجاء اختيار وقت آخر للخدمة.'),
                indicator: 'red'
            });
            frappe.model.set_value(cdt, cdn, 'time', '');
        }
        // Check if time and category are not empty
        if (!current_row.time || !current_row.category) {
            return;
        }

        let duration = current_row.duration || '1:00:00';

        // التحقق من توفر الموعد في القسم
        frappe.call({
            method: 'lilycenter.lilycenter.doctype.booking.booking.check_slot_availability',
            args: {
                category: current_row.category,
                time: current_row.time,
                duration: duration,
                booking_date: frm.doc.booking_date
            },
            callback: function(r) {
                if (r.message) {
                    if (r.message.error) {
                        frappe.msgprint({
                            title: __('خطأ'),
                            message: __(r.message.error),
                            indicator: 'red'
                        });
                        return;
                    }

                    if (!r.message.available) {
                        let debug_info = r.message.debug_info || {};
                        let existing_services = debug_info.existing_services || [];
                        
                        // تنسيق الوقت بشكل أفضل
                        let formattedServices = existing_services.map(service => {
                            let timeStr = service.time.padStart(8, '0');
                            return `• ${timeStr} (${service.duration} دقيقة)`;
                        }).join('\n');

                        let message = `
                            عذراً، هذا الموعد غير متاح في تاريخ ${debug_info.booking_date}.

                            معلومات القسم:
                            • القسم: ${current_row.category}
                            • السعة القصوى: ${debug_info.section_capacity} عميل في نفس الوقت

                            الموعد المطلوب:
                            • الوقت: ${current_row.time}
                            • المدة: ${debug_info.duration} دقيقة

                            المواعيد الحالية:
                            ${formattedServices}

                            الرجاء اختيار وقت آخر.`;

                        frappe.msgprint({
                            title: __('الموعد غير متاح'),
                            message: __(message),
                            indicator: 'red'
                        });
                        frappe.model.set_value(cdt, cdn, 'time', '');
                    } else {
                        frappe.show_alert({
                            message: __(`تم حجز الموعد في ${current_row.category} الساعة ${current_row.time}`),
                            indicator: 'green'
                        }, 5);
                    }
                }
            }
        });
    },

    service_name: function(frm, cdt, cdn) {
        // When the value of service_name changes, clear the worker field
        let row = locals[cdt][cdn];
        if (row.service_name) {
            frappe.db.get_value('Item Group', row.category, 'section_capacity', function(result) {
                if (result && result.section_capacity) {
                    frappe.model.set_value(cdt, cdn, 'section_capacity', result.section_capacity);
                }
            });
        }
        else{
            frappe.model.set_value(cdt, cdn, 'employee_account', null);
            frappe.model.set_value(cdt, cdn, 'worker', null);
            frappe.model.set_value(cdt, cdn, 'discount', null);
            frappe.model.set_value(cdt, cdn, 'discount_rate', null);
            frappe.model.set_value(cdt, cdn, 'time', null);
            frappe.model.set_value(cdt, cdn, 'section_capacity', null);
        }  // Set worker to null when service_name changes
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
