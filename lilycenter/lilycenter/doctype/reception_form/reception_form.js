// Copyright (c) 2024, hudhifa and contributors
// For license information, please see license.txt
// الدالة لفتح نافذة البحث عن الحجوزات
function open_booking_search_dialog(frm) {
    const dialog = new frappe.ui.Dialog({
        title: 'البحث عن حجز',
        fields: [
            {
                fieldtype: 'Link',
                label: 'اسم العميل',
                fieldname: 'customer',
                options: 'Customer',  // يحدد الحقل كـ Link يشير إلى Customer

                reqd: 1
            },
            {
                fieldtype: 'HTML',
                label: 'نتائج البحث',
                fieldname: 'search_results'
            }
        ],
        primary_action_label: 'بحث',
        primary_action(values) {
            frappe.call({
                method: 'lilycenter.lilycenter.doctype.reception_form.reception_form.get_bookings',
                args: { customer: values.customer },
                callback: function(r) {
                    if (r.message) {
                        render_booking_results(dialog, frm, r.message);
                    }
                }
            });
        }
    });
    
    dialog.show();
}

// الدالة لعرض نتائج البحث في نافذة البحث
function render_booking_results(dialog, frm, bookings) {
    let html = `
        <table class="table table-bordered">
            <thead>
                <tr>
                    <th>اسم العميل</th>
                    <th>تاريخ الحجز</th>
                    <th>حالة الحجز</th>
                    <th>اختيار</th>
                </tr>
            </thead>
            <tbody>
    `;

    bookings.forEach(booking => {
        html += `
            <tr>
                <td>${booking.customer}</td>
                <td>${booking.booking_date}</td>
                <td>${booking.booking_status}</td>
                <td><button class="btn btn-primary btn-sm select-booking" data-booking-id="${booking.name}">اختيار</button></td>
            </tr>
        `;
    });

    html += `</tbody></table>`;

    dialog.fields_dict.search_results.$wrapper.html(html);

    // إضافة حدث عند النقر على زر اختيار
    dialog.fields_dict.search_results.$wrapper.find('.select-booking').on('click', function() {
        let booking_id = $(this).data('booking-id');

        frappe.call({
            method: "lilycenter.lilycenter.doctype.reception_form.reception_form.get_booking_details",
            args: { booking_id: booking_id },
            callback: function(r) {
                if (r.message) {
                    // تعبئة نموذج الاستقبال ببيانات الحجز المختار
                    frm.set_value('customer', r.message.customer);

                    frm.clear_table('services');
                    (r.message.services || []).forEach(service => {
                        let row = frm.add_child('services');
                        row.service_name = service.service_name;
                        row.category = service.category;
                        row.time = service.time;
                        row.price = service.price;
                        row.worker = service.worker;
                        row.discount = service.discount;
                        row.discount_rate = service.discount_rate;
                        row.income_account = service.income_account;
                        row.discount_account = service.discount_account;
                    });
                    frm.clear_table('payments');
                    (r.message.payments || []).forEach(payment => {
                        let row = frm.add_child('payments');
                        row.mode_of_payment = payment.mode_of_payment;
                        row.amount = payment.amount;
                        row.reference_no = payment.reference_no;
                        row.reference_date = payment.reference_date;
                        row.comments = payment.comments;
                    });
                    
                    frm.refresh_fields(['customer', 'services','payments']);
                    dialog.hide();  // إخفاء نافذة البحث بعد اختيار الحجز
                }
            }
        });
    });
}

frappe.ui.form.on("Reception Form", {
    refresh(frm) {
        frm.add_custom_button(__('عرض حجوزات اليوم'), function() {
            frm.call({
                method: 'lilycenter.lilycenter.doctype.booking.booking.get_today_bookings',
                callback: function(r) {
                    if (r.message) {
                        // افتح نافذة حوارية لعرض نتائج الحجوزات
                        let html = '<table class="table table-bordered"><thead><tr><th>اسم العميل</th><th>اسم الخدمة</th><th>الموظف</th><th>وقت الخدمة</th><th>تاريخ الحجز</th></tr></thead><tbody>';
                        r.message.forEach(row => {
                            html += `<tr>
                                        <td>${row.customer}</td>
                                        <td>${row.customer}</td>
                                        <td>${row.customer}</td>
                                        <td>${row.customer}</td>
                                        <td>${row.booking_date}</td>
                                      </tr>`;
                        });
                        html += '</tbody></table>';
    
                        // عرض النتائج في نافذة حوارية
                        frappe.msgprint({
                            title: __('حجوزات اليوم'),
                            message: html,
                            indicator: 'green'
                        });
                    }
                }
            });
        });
        // إضافة زر للبحث عن الحجوزات
        frm.add_custom_button(__('بحث عن حجز'), function() {
            open_booking_search_dialog(frm);
        });
        
        frm.add_custom_button(__('اضافه حجز'), function() {
        // Route to the Reception Form with the current booking ID
        frappe.set_route('Form', 'Booking', {
            // booking_id: frm.doc.name,      // Pass current booking's ID
            // customer: frm.doc.customer     // Pass customer information
        });
        });
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
    validate: function(frm) {
        var total_payment = 0;
        
        // حساب مجموع الدفعات المدخلة
        frm.doc.payments.forEach(function(row) {
            total_payment += row.amount;
        });
        
        // مقارنة مجموع الدفعات بالمبلغ الإجمالي المستحق
        if (frm.doc.total_payment !== frm.doc.total) {
            frappe.throw({
                title: __('خطأ في الدفع'),
                message: __('مجموع الدفعات يجب أن يساوي المبلغ الإجمالي المستحق.'),
                indicator: 'red'
            });
            frappe.validated = false;
        }
    },
    before_save: function(frm) {
        if (frm.doc.services && frm.doc.services.length > 0) {
            
            
            frm.clear_table('worker_commission');

            frm.clear_table('materials');

            frm.doc.services.forEach(service => {
                var child = frm.add_child("worker_commission");
                child.worker = service.worker; 
                child.service_name = service.service_name;
                child.price_of_service = service.price; 

                frappe.call({
                    method: 'lilycenter.lilycenter.doctype.reception_form.reception_form.get_worker_commission_rate',
                    args: {
                        worker: service.worker,
                        service_name: service.service_name
                    },
                    callback: function(r) {
                        if (r.message) {
                            // Assuming r.message is the commission_rate
                            child.commission_rate = r.message;
                            child.worker_salary = (child.commission_rate / 100) * child.price_of_service; // Assuming commission_rate is in percentage
                        } else {
                            frappe.msgprint(__('No commission rate found for the selected worker and service.'));
                        }
                    }
                });

                // Refresh the child table to display the updated values
                frm.refresh_field("worker_commission");


                frappe.call({
                    method: 'lilycenter.lilycenter.doctype.reception_form.reception_form.get_material',
                    args: {
                        condition_value: service.service_name
                    },
                    callback: function(r) {
                        if (r.message) {
                            r.message.forEach(function(row) {
                                var child = frm.add_child("materials");
                                child.item_code = row.item_code; 
                                child.quantity = row.quantity; 
                                child.uom = row.uom; 
                            });
                            frm.refresh_field("materials");
                        }
                    }
                });
                
            });
        
        }
    }
    
    
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
    // mode_of_payment: function(frm, cdt, cdn) {
    //     var row = locals[cdt][cdn];
    
    //     if (row.mode_of_payment) {
    //         frappe.call({
    //             method: 'lilycenter.lilycenter.doctype.reception_form.reception_form.get_account_for_mode_of_payment',
    //             args: {
    //                 mode_of_payment: row.mode_of_payment
    //             },
    //             callback: function(response) {
    //                 if (response.message) {
    //                     frappe.model.set_value(cdt, cdn, 'paid_to', response.message);
    //                 } else {
    //                     frappe.msgprint(__('No account linked to the selected Mode of Payment.'));
    //                     frappe.model.set_value(cdt, cdn, 'paid_to', '');
    //                 }
    //             }
    //         });
    //     } else {
    //         frappe.model.set_value(cdt, cdn, 'paid_to', '');
    //     }
    // },
    
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
