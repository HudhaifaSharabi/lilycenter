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
            frappe.msgprint(__('لا يمكن اختيار تاريخ  سابق')); // رسالة خطأ بالعربي
            frm.set_value('booking_date', today);
        }
        
            // تفريغ محتوى Child Table
            frm.clear_table('services');
            frm.refresh_field('services');
            frm.set_value('total', 0);
        
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
        frm.fields_dict['services'].grid.get_field('service_name').get_query = function(doc, cdt, cdn) {
            return {
                filters: {
                    'status': 'نشط'
                }
            };
        };
        frm.fi
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

      
        let child_table = frm.doc.services || [];
        let validation_errors = false;

        function convertToMinutes(time) {
            let [hours, minutes] = time.split(':').map(Number);
            return (hours || 0) * 60 + (minutes || 0);
        }

        // Iterate over the child table to perform validation checks
        for (let current_row of child_table) {
            if (!current_row.time || !current_row.worker || !current_row.service_name || !current_row.duration) {
                continue; // Skip rows with incomplete data
            }

            let duration = current_row.duration || '01:00:00'; // Default duration
            let duration_minutes = convertToMinutes(duration);

            let requested_start = convertToMinutes(current_row.time);
            let requested_end = requested_start + duration_minutes;

            // Check for conflicts within the same child table
            for (let row of child_table) {
                if (row.name === current_row.name) continue; // Skip comparing the same row

                if (row.worker === current_row.worker) {
                    let service_start = convertToMinutes(row.time);
                    let service_end = service_start + convertToMinutes(row.duration || '01:00:00');

                    if (!(requested_end <= service_start || requested_start >= service_end)) {
                        let conflict_message = row.service_name === current_row.service_name
                            ? __('تداخل الحجز: الخدمة "{0}" مذكوره بلفعل في الجدول   لنفس الموظف الساعة {1} وتستغرق {2}. الرجاء اختيار وقت مختلف.',  [row.service_name, row.time, service_end])
                            : __('تداخل الحجز: الموظف  لديه حجز آخر لخدمة مختلفة في نفس الجدول لنفس العميل  الساعة {0} وتستغرق {1}. الرجاء اختيار وقت مختلف.',  [  row.time, service_end]);
                        
                        frappe.msgprint({
                            title: __('Booking Conflict'),
                            message: conflict_message,
                            indicator: 'red'
                        });
                        frappe.model.set_value(current_row.doctype, current_row.name, 'time', '');

                        validation_errors = true;
                        break;
                    }
                }
            }
            frappe.call({
                method: 'lilycenter.lilycenter.doctype.reception_form.reception_form.check_slot_availability',
                args: {
                    service_name: current_row.service_name,
                    worker: current_row.worker,
                    time: current_row.time,
                    duration: duration,
                    date:frm.doc.booking_date,
                    exclude_document: frm.doc.name
                },
                async: false, // Ensure synchronous behavior before save
                callback: function (r) {
                    if (r.message) {
                        if (r.message.error) {
                            frappe.msgprint({
                                title: __('Error'),
                                message: __(r.message.error),
                                indicator: 'red'
                            });
                            frappe.model.set_value(cdt, cdn, 'time', '');

                            frappe.validated = false; // Prevent save
                            return;
                        }
    
                        if (!r.message.available) {
                            frappe.msgprint({
                                title: __('الموعد غير متاح'),
                                message: __(`تم تجاوز القدرة الاستيعابية لهذا الموظف لخدمة ${current_row.service_name} حيث لديه عميل في الساعه ${r.message.current_service_time} وهذه الخدمه تستغرق ${duration}  `),
                                indicator: 'red'
                            });
                            frappe.model.set_value(current_row.doctype, current_row.name, 'time', '');

                            frappe.validated = false; // Prevent save
                        }
                    }
                }
            });
        }

        // Stop saving if there are validation errors
        if (validation_errors) {
            frappe.validated = false; // Prevent save
            return;
        }

       
        
    },

});


frappe.ui.form.on('Reception Service', {
    service_name: function(frm, cdt, cdn) {
        let row = locals[cdt][cdn];
        

            // frappe.db.get_value('Item Group', row.category, 'section_capacity', function(result) {
            //     if (result && result.section_capacity) {
            //         frappe.model.set_value(cdt, cdn, 'section_capacity', result.section_capacity);
            //     }
            // });
            frappe.model.set_value(cdt, cdn, 'employee_account', null);
            frappe.model.set_value(cdt, cdn, 'worker', null);
            frappe.model.set_value(cdt, cdn, 'discount', null);
            frappe.model.set_value(cdt, cdn, 'discount_rate', null);
            frappe.model.set_value(cdt, cdn, 'discount_amount', null);

            frappe.model.set_value(cdt, cdn, 'time', null);
            frappe.model.set_value(cdt, cdn, 'section_capacity', null);
            frappe.model.set_value(cdt, cdn, 'section_capacity', null);
            frappe.model.set_value(cdt, cdn, 'duration', null);
            if (row.service_name) {
                frappe.call({
                    method: 'lilycenter.lilycenter.doctype.reception_form.reception_form.get_latest_price',
                    args: {
                        item_code: row.service_name
                    },
                    callback: function(r) {
                        if (r.message) {
                            frappe.model.set_value(cdt, cdn, 'price', r.message);
                            frm.refresh_field('services');
                            calculate_total(frm);
                        } else {
                            frappe.msgprint(__('لم يتم العثور على سعر لهذه الخدمة'));
                        }
                    }
                });
            }
        
       
    },

    worker: function(frm, cdt, cdn) {
        let row = locals[cdt][cdn];

            frappe.model.set_value(cdt, cdn, 'employee_account', null);
            frappe.model.set_value(cdt, cdn, 'time', null);
            frappe.model.set_value(cdt, cdn, 'section_capacity', null);
            frappe.model.set_value(cdt, cdn, 'section_capacity', null);
            frappe.model.set_value(cdt, cdn, 'duration', null);

        if (row.worker && row.service_name) {
            // استدعاء القدرة الاستيعابية والفترة بناءً على الخدمة والموظف
            frappe.call({
                method: 'frappe.client.get_value',
                args: {
                    doctype: 'Worker Commission',
                    filters: { service_name: row.service_name ,worker: row.worker },
                    fieldname: ['section_capacity', 'duration']
                },
                callback: function(r) {
                    if (r.message) {
                        let section_capacity = r.message.section_capacity || 0;
                        let duration = r.message.duration || 60; // قيمة افتراضية إذا لم تكن موجودة

                        // تحديث الحقول في السطر الحالي
                        frappe.model.set_value(cdt, cdn, 'section_capacity', section_capacity);
                        frappe.model.set_value(cdt, cdn, 'duration', duration);
                    }
                }
            });
        } else {
            // إذا لم تكن البيانات مكتملة
            frappe.model.set_value(cdt, cdn, 'section_capacity', null);
            frappe.model.set_value(cdt, cdn, 'duration', null);
        }
    },
    time: function (frm, cdt, cdn) {
        let current_row = locals[cdt][cdn];

        if (!current_row.time || !current_row.worker || !current_row.service_name || !current_row.duration) {
            return;
        }
    
        let duration = current_row.duration || '01:00:00'; // المدة الافتراضية
        let duration_minutes = convertToMinutes(duration);
    
        // تحويل الوقت إلى دقائق
        function convertToMinutes(time) {
            let time_parts = time.split(':');
            let hours = parseInt(time_parts[0]) || 0; // ساعات
            let minutes = parseInt(time_parts[1]) || 0; // دقائق
            return (hours * 60) + minutes;
        }
    
        let requested_start = convertToMinutes(current_row.time);
        let requested_end = requested_start + duration_minutes;
    
        // التحقق المحلي
        let child_table = frm.doc.services || [];
        let current_overlapping = 0;
        let section_capacity = 1; // القيمة الافتراضية للقدرة الاستيعابية
    
        for (let row of child_table) {
            if (row.name === current_row.name) continue; // تجاهل السجل الحالي
    
            if (row.worker === current_row.worker) {
                let service_start = convertToMinutes(row.time);
                let service_duration_minutes = convertToMinutes(row.duration || '01:00:00');
                let service_end = service_start + service_duration_minutes;
    
                // التحقق من التداخل بين نفس الخدمة
                if (!(requested_end <= service_start || requested_start >= service_end)) {
                    if (row.service_name === current_row.service_name) {
                        frappe.msgprint({
                            title: __('خطأ في الحجز'),
                            message: __('تداخل الحجز: الخدمة "{0}" مذكوره بلفعل في الجدول   لنفس الموظف الساعة {1} وتستغرق {2}. الرجاء اختيار وقت مختلف.', 
                                [row.service_name, row.time, service_end]
                            ),
                            indicator: 'red'
                        });
                        frappe.model.set_value(cdt, cdn, 'time', '');
                        return;
                    } else {
                        frappe.msgprint({
                            title: __('خطأ في الحجز'),
                            message: __('تداخل الحجز: الموظف  لديه حجز آخر لخدمة مختلفة في نفس الجدول لنفس العميل  الساعة {0} وتستغرق {1}. الرجاء اختيار وقت مختلف.', 
                                [  row.time, service_end]
                            ),
                            indicator: 'red'
                        });
                        frappe.model.set_value(cdt, cdn, 'time', '');
                        return;
                    }
                }
            }
        }
    
        // جلب القدرة الاستيعابية للخدمة
        // frappe.call({
        //     method: 'frappe.client.get_value',
        //     args: {
        //         doctype: 'Worker Commission',
        //         filters: { worker: current_row.worker, service_name: current_row.service_name },
        //         fieldname: 'section_capacity'
        //     },
        //     callback: function (r) {
        //         if (r.message && r.message.section_capacity) {
        //             section_capacity = parseInt(r.message.section_capacity);
        //         }
    
        //         // التحقق من القدرة الاستيعابية
        //         if (current_overlapping >= section_capacity) {
        //             frappe.msgprint({
        //                 title: __('خطأ في الحجز'),
        //                 message: __('تم تجاوز القدرة الاستيعابية لهذا الموظف لهذه الخدمة.'),
        //                 indicator: 'red'
        //             });
        //             frappe.model.set_value(cdt, cdn, 'time', '');
        //         } else {
        //             frappe.show_alert({
        //                 message: __('تم حجز الموعد بنجاح.'),
        //                 indicator: 'green'
        //             });
        //         }
        //     }
        // });
        // التحقق من التداخل مع الحجوزات في قاعدة البيانات
        frappe.call({
            method: 'lilycenter.lilycenter.doctype.reception_form.reception_form.check_slot_availability',
            args: {
                service_name: current_row.service_name,
                worker: current_row.worker,
                time: current_row.time,
                duration: duration,
                date:frm.doc.booking_date,
                exclude_document: frm.doc.name
            },
            callback: function (r) {
                if (r.message) {
                    if (r.message.error) {
                        frappe.msgprint({
                            title: __('خطأ'),
                            message: __(r.message.error),
                            indicator: 'red'
                        });
                        frappe.model.set_value(cdt, cdn, 'time', '');
                        return;
                    }
    
                    if (!r.message.available) {
                        frappe.msgprint({
                            title: __('الموعد غير متاح'),
                            message: __(`تم تجاوز القدرة الاستيعابية لهذا الموظف لخدمة ${current_row.service_name} حيث لديه عميل في الساعه ${r.message.current_service_time} وهذه الخدمه تستغرق ${duration}  `),
                            indicator: 'red'
                        });
                        frappe.model.set_value(cdt, cdn, 'time', '');
                    } else {
                        frappe.show_alert({
                            message: __('الموعد متاح'),
                            indicator: 'green'
                        });
                    }
                }
            }
        });
    },
    discount: function(frm, cdt, cdn) {
        let row = locals[cdt][cdn];
        calculate_total(frm);
    },
    price: function(frm, cdt, cdn) {
        let row = locals[cdt][cdn];
        
        calculate_total(frm);
    },

    discount_percentage: function(frm, cdt, cdn) {
        calculate_total(frm);
    },

    services_add: function(frm) {
        calculate_total(frm);
    },
    services_remove: function(frm) {
        calculate_total(frm); // Recalculate the total payment
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
