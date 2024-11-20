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

                        // Get section_capacity for each service
                        if (service.category) {
                            frappe.db.get_value('Item Group', service.category, 'section_capacity', function(result) {
                                if (result && result.section_capacity) {
                                    frappe.model.set_value(row.doctype, row.name, 'section_capacity', result.section_capacity);
                                }
                            });
                        }
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

                    // Calculate totals after loading all data
                    calculate_total(frm);
                    calculate_total_payment(frm);

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
                        // تجميع الفئات الفريدة
                        let categories = [...new Set(r.message.map(b => b.category))];
                        
                        // إنشاء جدول HTML
                        let html = '<table class="table table-bordered">';
                        
                        // إنشاء رأس الجدول
                        html += '<thead><tr>';
                        html += '<th>الوقت</th>';
                        categories.forEach(category => {
                            html += `<th>${category}</th>`;
                        });
                        html += '</tr></thead><tbody>';
                        
                        // تجميع الحجوزات حسب الوقت
                        let timeGroups = {};
                        r.message.forEach(booking => {
                            if (!timeGroups[booking.service_time]) {
                                timeGroups[booking.service_time] = {};
                            }
                            timeGroups[booking.service_time][booking.category] = {
                                customer: booking.customer,
                                worker_name: booking.worker_name
                            };
                        });
                        
                        // إنشاء صفوف الجدول
                        Object.keys(timeGroups).sort().forEach(time => {
                            html += '<tr>';
                            html += `<td>${time}</td>`;
                            
                            categories.forEach(category => {
                                let booking = timeGroups[time][category];
                                if (booking) {
                                    html += `<td>
                                        العميل: ${booking.customer}<br>
                                        الموظف: ${booking.worker_name}
                                    </td>`;
                                } else {
                                    html += '<td></td>';
                                }
                            });
                            
                            html += '</tr>';
                        });
                        
                        html += '</tbody></table>';
                        
                        // عرض النتائج في نافذة حوارية
                        frappe.msgprint({
                            title: __('حجوزات اليوم'),
                            message: html,
                            indicator: 'green',
                            wide: true
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
        // 1. Validate Services
        if (!frm.doc.services || !frm.doc.services.length) {
            frappe.throw({
                title: __('خطأ في الخدمات'),
                message: __('يجب إضافة خدمة واحدة على الأقل'),
                indicator: 'red'
            });
        }

        // 2. Validate each service has required fields
        frm.doc.services.forEach(service => {
            if (!service.service_name || !service.time || !service.worker) {
                frappe.throw({
                    title: __('بيانات ناقصة'),
                    message: __('يجب إكمال جميع بيانات الخدمة (اسم الخدمة، الوقت، الموظف)'),
                    indicator: 'red'
                });
            }
        });

        // 3. Validate Payments when status is "مؤكد"
        if (frm.doc.statues === "مؤكد") {
            if (!frm.doc.payments || !frm.doc.payments.length) {
                frappe.throw({
                    title: __('خطأ في الدفع'),
                    message: __('يجب إضافة طريقة دفع واحدة على الأقل عند تأكيد الحجز'),
                    indicator: 'red'
                });
            }

            // 4. Validate payment total matches service total
            let total_payments = 0;
            frm.doc.payments.forEach(payment => {
                total_payments += payment.amount || 0;
            });

            if (total_payments !== frm.doc.total) {
                frappe.throw({
                    title: __('خطأ في الدفع'),
                    message: __('مجموع الدفعات يجب أن يساوي المبلغ الإجمالي المستحق'),
                    indicator: 'red'
                });
            }
        }
    },
    before_save: function(frm) {
        // Check for time conflicts first
        let hasTimeConflict = false;
        let checkedServices = frm.doc.services.filter(service => service.check_time);
        
        for (let i = 0; i < checkedServices.length; i++) {
            for (let j = i + 1; j < checkedServices.length; j++) {
                if (checkedServices[i].time === checkedServices[j].time && 
                    checkedServices[i].category === checkedServices[j].category) {
                    hasTimeConflict = true;
                    break;
                }
            }
        }
        
        if (hasTimeConflict) {
            frappe.throw({
                title: __('تنبيه'),
                message: __('يوجد تعارض في مواعيد الخدمات. يرجى التحقق من المواعيد قبل الحفظ.'),
                indicator: 'red'
            });
            return false;
        }

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
    },
    before_submit: function (frm) {
        if (frm.doc.statues !== "مؤكد") {
            frappe.throw({
                title: __('تنبيه'),
                message: __('يجب عليك تأكيد الحجز قبل الإرسال'),
                indicator: 'red'
            });
            return false;
        }
    },
    
    statues: function(frm) {
        if (frm.doc.statues === "مؤكد") {
            frm.set_df_property('payments', 'reqd', 1);
            
            // Check if payments table is empty
            if (!frm.doc.payments || frm.doc.payments.length === 0) {
                frappe.show_alert({
                    message: __('يجب إضافة طريقة دفع واحدة على الأقل'),
                    indicator: 'red'
                });
            }
            
            // Check if total payments match total amount
            let total_payments = 0;
            (frm.doc.payments || []).forEach(row => {
                total_payments += row.amount || 0;
            });
            
            if (total_payments !== frm.doc.total) {
                frappe.show_alert({
                    message: __('مجموع الدفعات يجب أن يساوي المبلغ الإجمالي المستحق'),
                    indicator: 'red'
                });
            }
        } else {
            frm.set_df_property('payments', 'reqd', 0);
        }
    },
});

frappe.ui.form.on('Reception Service', {
    service_name: function(frm, cdt, cdn) {
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
        }
    },

    worker: function(frm, cdt, cdn) {
        let row = locals[cdt][cdn];
        
    },

    time: function(frm, cdt, cdn) {
        let current_row = locals[cdt][cdn];
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
        if (!current_row.time || !current_row.category) {
            return;
        }

        let duration = current_row.duration || '1:00:00';

        // التحقق من توفر الموعد في القسم
        frappe.call({
            method: 'lilycenter.lilycenter.doctype.reception_form.reception_form.check_slot_availability',
            args: {
                category: current_row.category,
                time: current_row.time,
                duration: duration
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
                            let timeStr = service.time.padStart(8, '0'); // تأكد من تنسيق الوقت
                            return `• ${timeStr} (${service.duration} دقيقة)`;
                        }).join('\n');

                        let message = `
عذراً، هذا الموعد غير متاح حالياً.

الرجاء اختيار وقت آخر.`;

                        frappe.msgprint({
                            title: __('الموعد غير متاح'),
                            message: __(message),
                            indicator: 'red'
                        });
                        frappe.model.set_value(cdt, cdn, 'time', '');
                    } else {
                        // رسالة نجاح مختصرة
                        frappe.show_alert({
                            message: __(`تم استقبال الموعد في ${current_row.category} الساعة ${current_row.time}`),
                            indicator: 'green'
                        }, 5);
                    }
                }
            }
        });
    },

    price: function(frm, cdt, cdn) {
        let row = locals[cdt][cdn];
        
        calculate_total(frm);
    },

    discount_percentage: function(frm, cdt, cdn) {
        calculate_total(frm);
    }
});

frappe.ui.form.on('Reception Payments', {
    mode_of_payment: function(frm, cdt, cdn) {
        let row = locals[cdt][cdn];
        if (!row.mode_of_payment) {
            frappe.throw(__('يجب تحديد طريقة الدفع'));
        }

        // Bank payment validation
        frappe.db.get_value('Mode of Payment', row.mode_of_payment, 'type', function(value) {
            if (value && value.type === 'Bank') {
                frappe.meta.get_docfield("Reception Payments", "reference_no", frm.doc.name).reqd = 1;
                frappe.meta.get_docfield("Reception Payments", "reference_date", frm.doc.name).reqd = 1;
            }
        });
    },

    amount: function(frm, cdt, cdn) {
        let row = locals[cdt][cdn];
        if (!row.amount || row.amount <= 0) {
            frappe.throw(__('يجب أن يكون مبلغ الدفع أكبر من صفر'));
        }
        calculate_total_payment(frm);
    }
});

function calculate_total(frm) {
    let total = 0;
    if (frm.doc.services && frm.doc.services.length) {
        frm.doc.services.forEach(function(row) {
            let service_discount = 0;
            if (row.discount_percentage > 0) {
                service_discount = row.price * (row.discount_percentage / 100);
            }
            let amount = row.price - service_discount;
            total += amount || 0;
        });
    }
    frm.set_value('total', total);
    frm.refresh_field('total');
}

function calculate_total_payment(frm) {
    let total_payment = 0;
    if (frm.doc.payments && frm.doc.payments.length) {
        frm.doc.payments.forEach(function(row) {
            total_payment += row.amount || 0;
        }); 
    }
    frm.set_value('total_payment', total_payment);
    frm.refresh_field('total_payment');
}
function convertToDateTime(time) {
    let [hours, minutes] = time.split(":").map(Number);  // تقسيم الوقت إلى ساعات ودقائق
    let date = new Date();  // إنشاء كائن تاريخ جديد
    date.setHours(hours, minutes, 0, 0);  // تعيين ساعات ودقائق اليوم الحالي
    return date;  // إرجاع الكائن DateTime
}

// دالة لحساب وقت نهاية الخدمة بناءً على المدة
function getEndTime(start_time, duration) {
    let end_time = new Date(start_time);  // نسخ الوقت الأصلي
    // إضافة المدة (30 دقيقة أو 60 دقيقة) حسب المدة المحددة للخدمة
    end_time.setMinutes(start_time.getMinutes() + (duration === "30 دقيقة" ? 30 : 60));
    return end_time;  // إرجاع وقت النهاية
}