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
                //return all cooking
                // method: 'lilycenter.lilycenter.doctype.reception_form.reception_form.get_bookings',
                // return last five booking
                method: 'lilycenter.lilycenter.doctype.reception_form.reception_form.get_last_5_bookings',

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
                    frappe.call({
                        method: "lilycenter.lilycenter.doctype.reception_form.reception_form.check_unique_booking",
                        args: {
                            booking_id: r.message.booking_id
                        },
                        async: false, // Make it synchronous to block further actions
                        callback: function(response) {
                            if (response.message === "Booking ID is unique.") {
                                // If booking ID is unique, continue the submission process
                                 // تعبئة نموذج الاستقبال ببيانات الحجز المختار
                                    frm.set_value('customer', r.message.customer);
                                    frm.set_value('booking_id', r.message.booking_id);

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
                                        row.discount_amount = service.discount_amount;
                                        row.income_account = service.income_account;
                                        row.discount_account = service.discount_account;
                                        row.section_capacity = service.section_capacity;
                                        row.duration = service.duration;
                                        // Get section_capacity for each service
                                        // if (service.category) {
                                        //     frappe.db.get_value('Item Group', service.category, 'section_capacity', function(result) {
                                        //         if (result && result.section_capacity) {
                                        //             frappe.model.set_value(row.doctype, row.name, 'section_capacity', result.section_capacity);
                                        //         }
                                        //     });
                                        // }
                                    });
                                    frm.clear_table('booking_payments');
                                    (r.message.payments || []).forEach(payment => {
                                        let row = frm.add_child('booking_payments');
                                        row.mode_of_payment = payment.mode_of_payment;
                                        row.amount = payment.amount;
                                        row.reference_no = payment.reference_no;
                                        row.reference_date = payment.reference_date;
                                        row.comments = payment.comments;
                                    });
                                    
                                    frm.refresh_fields(['customer', 'services','booking_payments']);

                                    // Calculate totals after loading all data
                                    calculate_total(frm);
                                    calculate_total_payment(frm);

                                    dialog.hide();  // إخفاء نافذة البحث بعد اختيار الحجز
                                    calculate_total_booking_payments(frm);
                            } else {
                                // If booking ID is not unique, cancel the process and show an error message
                                frappe.msgprint(__('Booking ID already exists.'));
                                frappe.validated = false; // This cancels the submission
                            }
                        }
                    });
                   
                }
            }
        });
    });
}

frappe.ui.form.on("Reception Form", {
    
    
    refresh(frm) {

        
        // زر عرض الحجوزات بناءً على التاريخ
        frm.add_custom_button(__('عرض الحجوزات حسب التاريخ'), function() {
            // إنشاء نافذة لإدخال التاريخ
            frappe.prompt(
                [
                    {
                        label: 'اختر التاريخ',
                        fieldname: 'booking_date',
                        fieldtype: 'Date',
                        reqd: 1
                    }
                ],
                function(values) {
                    // استدعاء الميثود لعرض الحجوزات بناءً على التاريخ المدخل
                    frm.call({
                        method: 'lilycenter.lilycenter.doctype.booking.booking.get_bookings_by_date',
                        args: {
                            date: values.booking_date
                        },
                        callback: function(r) {
                            if (r.message) {
                                // Extract all categories from the response columns (excluding 'time_range')
                                let categories = r.message.columns.filter(column => column.fieldname !== 'time_range');

                                // Initialize time slots (00:00 - 23:00)
                                let timeSlots = [];
                                for (let i = 0; i < 24; i++) {
                                    let startTime = (i < 10 ? '0' : '') + i + ':00';
                                    let endTime = (i + 1 < 10 ? '0' : '') + (i + 1) + ':00';
                                    timeSlots.push(startTime + ' - ' + endTime);
                                }

                                // Create HTML for the table
                                let html = '<table class="table table-bordered">';
                                
                                // Create table header (time + categories)
                                html += '<thead><tr><th>الوقت</th>';
                                categories.forEach(category => {
                                    html += `<th>${category.label}</th>`;
                                });
                                html += '</tr></thead><tbody>';

                                // Create rows for each time slot
                                timeSlots.forEach(timeSlot => {
                                    // Row for bookings
                                    html += `<tr><td rowspan="2" >${timeSlot}</td>`;
                                    categories.forEach(category => {
                                        let bookingFound = false;
                                        let bookingDetails = [];

                                        // Loop through the bookings for the current time slot and category
                                        r.message.data.forEach(booking => {
                                            if (booking.time_range === timeSlot && booking.category === category.label) {
                                                // Collect customer, service, and worker name for display
                                                bookingDetails.push(`
                                                    العميل: ${booking.customer} <br>
                                                    الخدمة: ${booking.service_name} <br>
                                                    الموظف: ${booking.worker_name}
                                                    <br>...............................................<br>

                                                `);
                                                bookingFound = true;
                                            }
                                        });

                                        // If there are bookings, display them in the same cell
                                        if (bookingFound) {
                                            html += `<td>${bookingDetails.join('<br>')}</td>`;
                                        } else {
                                            // If no booking, display "No booking"
                                            html += '<td>لايوجد حجز</td>';
                                        }
                                    });
                                    html += '</tr>';

                                    // Row for reception
                                    categories.forEach(category => {
                                        let receptionFound = false;
                                        let receptionDetails = [];

                                        // Loop through the receptions for the current time slot and category
                                        r.message.receptions.forEach(reception => {
                                            if (reception.time_range === timeSlot && reception.category === category.label) {
                                                // Collect reception details for display
                                                receptionDetails.push(`
                                                   العميل: ${reception.customer} <br>
                                                    الخدمة: ${reception.service_name} <br>
                                                    الموظف: ${reception.worker_name}
                                                     <br>...............................................<br>
                                                `);
                                                receptionFound = true;
                                            }
                                        });

                                        // If there are receptions, display them in the same cell
                                        if (receptionFound) {
                                            html += `<td>${receptionDetails.join('<br>')}</td>`;
                                        } else {
                                            // If no reception, display "No reception"
                                            html += '<td>لايوجد استقبال</td>';
                                        }
                                    });
                                    html += '</tr>';
                                });

                                html += '</tbody></table>';
                                
                                // Show the generated table in a dialog
                                frappe.msgprint({
                                    title: __('حجوزات يوم: ') + values.booking_date,
                                    message: html,
                                    indicator: 'green',
                                    wide: true
                                });
                            } else {
                                frappe.msgprint({
                                    title: __('لا توجد حجوزات'),
                                    message: __('لا توجد حجوزات في التاريخ المدخل.'),
                                    indicator: 'red'
                                });
                            }
                        }
                    });
                },
                __('اختر التاريخ'),
                __('عرض')
            );
        });





        // إضافة زر للبحث عن الحجوزات
        if (frm.is_new()) {
            frm.add_custom_button(__('بحث عن حجز'), function() {
                open_booking_search_dialog(frm);
            });
        }
        
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
    frm.fields_dict['services'].grid.get_field('service_name').get_query = function(doc, cdt, cdn) {
        return {
            filters: {
                'status': 'نشط'
            }
        };
    };
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

            // 4. Calculate total from services
            let total = 0;
            frm.doc.services.forEach(function(row) {
                let service_discount = 0;
                if (row.discount_percentage > 0) {
                    service_discount = row.price * (row.discount_percentage / 100);
                }
                let amount = row.price - service_discount;
                total += amount || 0;
            });

            // Validate payment total matches calculated service total
            let total_payments = 0;
            frm.doc.payments.forEach(payment => {
                total_payments += payment.amount || 0;
            });
            let total_booking_payments = 0;

            frm.doc.booking_payments.forEach(booking_payment => {
                total_booking_payments += booking_payment.amount || 0;
            });
            
            
            total_payments = total_payments + total_booking_payments
            // if (total_payments !== total) {
            //     frappe.throw({
            //         title: __('خطأ في الدفع'),
            //         message: __('مجموع الدفعات يجب أن يساوي المبلغ الإجمالي المستحق'),
            //         indicator: 'red'
            //     });
            // }
        }

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
                    // date:frm.doc.date,
                    date:frappe.datetime.nowdate(),
                    exclude_document: frm.doc.name,
                    customer: frm.doc.customer,
                    request:"reception"
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

        // Perform server-side validation for additional checks
        
    },

    before_save: function(frm) {
        calculate_total(frm);
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
                                child.service_name = service.service_name;
                                
                                // جلب آخر سعر من Stock Ledger Entry
                                frappe.call({
                                    method: 'lilycenter.lilycenter.doctype.reception_form.reception_form.get_latest_stock_rate',
                                    args: {
                                        item_code: row.item_code
                                    },
                                    callback: function(r) {
                                        if (r.message) {
                                            child.rate = r.message;
                                            frm.refresh_field("materials");
                                        }
                                    }
                                });
                            });
                            frm.refresh_field("materials");
                        }
                    }
                });
                
            });
        
        }
    },
    before_submit: function (frm) {
        if (frm.doc.statues !== "مؤكد" && frm.doc.statues !== "أجل") {
            frappe.throw({
                title: __('تنبيه'),
                message: __('يجب عليك تأكيد الحجز أو تأجيله قبل الإرسال'),
                indicator: 'red'
            });
            return false;
        }

        // Check payment validation for "أجل" status
        let total = 0;
        frm.doc.services.forEach(service => {
            let service_discount = 0
            if (service.type_of_discount == "نسبة" && service.discount_rate  > 0) {
                 service_discount =service.price * service.discount_rate / 100
            }
            else if(service.type_of_discount == "مبلغ" && service.discount_amount  > 0){
                 service_discount = service.discount_amount 
            }

            let amount = service.price - service_discount;
            total += amount;
        });

        // Calculate total booking payments
        let total_booking_payments = 0;
        if (frm.doc.booking_payments) {
            total_booking_payments = frm.doc.booking_payments.reduce((sum, payment) => sum + payment.amount, 0);
        }

        // Calculate total payments
        let total_payments = 0;
        if (frm.doc.payments) {
            total_payments = frm.doc.payments.reduce((sum, payment) => sum + payment.amount, 0);
        }

        // Calculate grand total of all payments
        let grand_total_payments = total_payments + total_booking_payments;

        // التحقق من المدفوعات حسب الحالة
        if (frm.doc.statues === "مؤكد") {
            if (grand_total_payments !== total) {
                frappe.throw({
                    title: __('خطأ في الدفع'),
                    message: __('مجموع الدفعات يجب أن يساوي المبلغ الإجمالي المستحق'),
                    indicator: 'red'
                });
                return false;
            }
        } else if (frm.doc.statues === "أجل") {
            if (grand_total_payments >= total) {
                frappe.throw({
                    title: __('خطأ في الدفع'),
                    message: __('في حالة التأجيل، يجب أن يكون المبلغ المدفوع أقل من المبلغ الإجمالي'),
                    indicator: 'red'
                });
                return false;
            }
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
            
            // Calculate total from services
            let total = 0;
            frm.doc.services.forEach(function(row) {
                let service_discount = 0;
                if (row.discount_percentage > 0) {
                    service_discount = row.price * (row.discount_percentage / 100);
                }
                let amount = row.price - service_discount;
                total += amount || 0;
            });
            
            // Calculate total payments including booking payments
            let total_payments = 0;
            (frm.doc.payments || []).forEach(row => {
                total_payments += row.amount || 0;
            });
            
            let total_booking_payments = 0;
            (frm.doc.booking_payments || []).forEach(booking_payment => {
                total_booking_payments += booking_payment.amount || 0;
            });
            
            let grand_total_payments = total_payments + total_booking_payments;
            
            if (grand_total_payments !== total) {
                frappe.show_alert({
                    message: __('مجموع الدفعات يجب أن يساوي المبلغ الإجمالي المستحق'),
                    indicator: 'red'
                });
            }
        } else if (frm.doc.statues === "أجل") {
            frm.set_df_property('payments', 'reqd', 0);
            
            // Calculate totals including booking payments
            let total = frm.doc.total || 0;
            let total_payments = (frm.doc.total_payment || 0);
            let total_booking_payments = (frm.doc.total_booking_payments || 0);
            
            let grand_total_payments = total_payments + total_booking_payments;
            
            if (grand_total_payments >= total) {
                frappe.show_alert({
                    message: __('في حالة التأجيل، يجب أن يكون المبلغ المدفوع أقل من المبلغ الإجمالي'),
                    indicator: 'red'
                });
            }
        } else {
            frm.set_df_property('payments', 'reqd', 0);
        }
    },
    customer: function(frm) {
        // Clear the services table when the customer is changed
        frm.clear_table('services');
        frm.clear_table('booking_payments');
        frm.clear_table('payments');
        frm.clear_table('worker_commission');
        frm.clear_table('materials');
        frm.refresh_fields(['services', 'booking_payments', 'payments', 'worker_commission', 'materials']);
        calculate_total(frm);
        calculate_total_payment(frm);
        calculate_total_booking_payments(frm);

        
    }
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
    // time: function (frm, cdt, cdn) {
    //     let current_row = locals[cdt][cdn];

    //     if (!current_row.time || !current_row.worker || !current_row.service_name || !current_row.duration) {
    //         return;
    //     }
    
    //     let duration = current_row.duration || '01:00:00'; // المدة الافتراضية
    //     let duration_minutes = convertToMinutes(duration);
    
    //     // تحويل الوقت إلى دقائق
    //     function convertToMinutes(time) {
    //         let time_parts = time.split(':');
    //         let hours = parseInt(time_parts[0]) || 0; // ساعات
    //         let minutes = parseInt(time_parts[1]) || 0; // دقائق
    //         return (hours * 60) + minutes;
    //     }
    
    //     let requested_start = convertToMinutes(current_row.time);
    //     let requested_end = requested_start + duration_minutes;
    
    //     // التحقق المحلي
    //     let child_table = frm.doc.services || [];
    //     let current_overlapping = 0;
    //     let section_capacity = 1; // القيمة الافتراضية للقدرة الاستيعابية
    
    //     for (let row of child_table) {
    //         if (row.name === current_row.name) continue; // تجاهل السجل الحالي
    
    //         if (row.worker === current_row.worker) {
    //             let service_start = convertToMinutes(row.time);
    //             let service_duration_minutes = convertToMinutes(row.duration || '01:00:00');
    //             let service_end = service_start + service_duration_minutes;
    
    //             // التحقق من التداخل بين نفس الخدمة
    //             if (!(requested_end <= service_start || requested_start >= service_end)) {
    //                 if (row.service_name === current_row.service_name) {
    //                     frappe.msgprint({
    //                         title: __('خطأ في الحجز'),
    //                         message: __('تداخل الحجز: الخدمة "{0}" مذكوره بلفعل في الجدول   لنفس الموظف الساعة {1} وتستغرق {2}. الرجاء اختيار وقت مختلف.', 
    //                             [row.service_name, row.time, service_end]
    //                         ),
    //                         indicator: 'red'
    //                     });
    //                     frappe.model.set_value(cdt, cdn, 'time', '');
    //                     return;
    //                 } else {
    //                     frappe.msgprint({
    //                         title: __('خطأ في الحجز'),
    //                         message: __('تداخل الحجز: الموظف  لديه حجز آخر لخدمة مختلفة في نفس الجدول لنفس العميل  الساعة {0} وتستغرق {1}. الرجاء اختيار وقت مختلف.', 
    //                             [  row.time, service_end]
    //                         ),
    //                         indicator: 'red'
    //                     });
    //                     frappe.model.set_value(cdt, cdn, 'time', '');
    //                     return;
    //                 }
    //             }
    //         }
    //     }
    
    //     // جلب القدرة الاستيعابية للخدمة
    //     // frappe.call({
    //     //     method: 'frappe.client.get_value',
    //     //     args: {
    //     //         doctype: 'Worker Commission',
    //     //         filters: { worker: current_row.worker, service_name: current_row.service_name },
    //     //         fieldname: 'section_capacity'
    //     //     },
    //     //     callback: function (r) {
    //     //         if (r.message && r.message.section_capacity) {
    //     //             section_capacity = parseInt(r.message.section_capacity);
    //     //         }
    
    //     //         // التحقق من القدرة الاستيعابية
    //     //         if (current_overlapping >= section_capacity) {
    //     //             frappe.msgprint({
    //     //                 title: __('خطأ في الحجز'),
    //     //                 message: __('تم تجاوز القدرة الاستيعابية لهذا الموظف لهذه الخدمة.'),
    //     //                 indicator: 'red'
    //     //             });
    //     //             frappe.model.set_value(cdt, cdn, 'time', '');
    //     //         } else {
    //     //             frappe.show_alert({
    //     //                 message: __('تم حجز الموعد بنجاح.'),
    //     //                 indicator: 'green'
    //     //             });
    //     //         }
    //     //     }
    //     // });
    //     // التحقق من التداخل مع الحجوزات في قاعدة البيانات
    //     frappe.call({
    //         method: 'lilycenter.lilycenter.doctype.reception_form.reception_form.check_slot_availability',
    //         args: {
    //             service_name: current_row.service_name,
    //             worker: current_row.worker,
    //             time: current_row.time,
    //             duration: duration,
    //             date:frm.doc.date,
    //             exclude_document: frm.doc.name
    //         },
    //         callback: function (r) {
    //             if (r.message) {
    //                 if (r.message.error) {
    //                     frappe.msgprint({
    //                         title: __('خطأ'),
    //                         message: __(r.message.error),
    //                         indicator: 'red'
    //                     });
    //                     frappe.model.set_value(cdt, cdn, 'time', '');
    //                     return;
    //                 }
    
    //                 if (!r.message.available) {
    //                     frappe.msgprint({
    //                         title: __('الموعد غير متاح'),
    //                         message: __(`تم تجاوز القدرة الاستيعابية لهذا الموظف لخدمة ${current_row.service_name} حيث لديه عميل في الساعه ${r.message.current_service_time} وهذه الخدمه تستغرق ${duration}  `),
    //                         indicator: 'red'
    //                     });
    //                     frappe.model.set_value(cdt, cdn, 'time', '');
    //                 } else {
    //                     frappe.show_alert({
    //                         message: __('الموعد متاح'),
    //                         indicator: 'green'
    //                     });
    //                 }
    //             }
    //         }
    //     });
    // },
    time: function (frm, cdt, cdn) {
        console.log("التاريخ المرسل:", frm.doc.date);

        let current_row = locals[cdt][cdn];
        if(current_row.time){
            if (!current_row.time || !current_row.worker || !current_row.service_name || !current_row.duration) {
                frappe.msgprint({
                    title: __('خطأ'),
                    message: __(`يرجى ملء جميع الحقول المطلوبة (اسم الخدمة، الموظف،الوقت ، المدة)`),
                    indicator: 'red'
                });
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
                                message: __('تداخل الحجز: الخدمة "{0}" مذكوره بلفعل في الجدول لنفس الموظف الساعة {1} وتستغرق {2}. الرجاء اختيار وقت مختلف.', 
                                    [row.service_name, row.time, service_end]
                                ),
                                indicator: 'red'
                            });
                            frappe.model.set_value(cdt, cdn, 'time', '');
                            return;
                        } else {
                            frappe.msgprint({
                                title: __('خطأ في الحجز'),
                                message: __('تداخل الحجز: الموظف لديه حجز آخر لخدمة مختلفة في نفس الجدول لنفس العميل الساعة {0} وتستغرق {1}. الرجاء اختيار وقت مختلف.', 
                                    [row.time, service_end]
                                ),
                                indicator: 'red'
                            });
                            frappe.model.set_value(cdt, cdn, 'time', '');
                            return;
                        }
                    }
                }
            }
        
            // التحقق من التداخل مع الحجوزات في قاعدة البيانات
            frappe.call({
                method: 'lilycenter.lilycenter.doctype.reception_form.reception_form.check_slot_availability',
                args: {
                    service_name: current_row.service_name,
                    worker: current_row.worker,
                    time: current_row.time,
                    duration: duration,
                    date: frappe.datetime.nowdate(),
                    exclude_document: frm.doc.name,
                    customer: frm.doc.customer,
                    request:"reception"
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
        }
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
    payments_add: function(frm) {
        console.log("Row added to Reception Payments");
        calculate_total_payment(frm);
    },
    payments_remove: function(frm) {
        console.log("Row removed from Reception Payments");
        calculate_total_payment(frm); // Recalculate the total payment
    },
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
    },
    reception_payments_remove: function(frm) {
        calculate_total_payment(frm); // Recalculate total payment after row removal
    }
    
});

function calculate_total(frm) {
    let total = 0;
    if (frm.doc.services && frm.doc.services.length) {
        frm.doc.services.forEach(function(row) {
            let service_discount = 0;
            
            if (row.type_of_discount == "نسبة" && row.discount_rate > 0) {
                service_discount = row.price * (row.discount_rate / 100);
            }
            else if (row.type_of_discount == "مبلغ" ) {
                service_discount = row.discount_amount;
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
function calculate_total_booking_payments(frm) {
    let total_booking_payments = 0;
    if (frm.doc.booking_payments && frm.doc.booking_payments.length) {
        frm.doc.booking_payments.forEach(function(row) {
            total_booking_payments += row.amount || 0;
        }); 
    }
    frm.set_value('total_booking_payments', total_booking_payments);
    frm.refresh_field('total_booking_payments');
}
// function convertToDateTime(time) {
//     let [hours, minutes] = time.split(":").map(Number);  // تقسيم الوقت إلى ساعات ودقائق
//     let date = new Date();  // إنشاء كائن تاريخ جديد
//     date.setHours(hours, minutes, 0, 0);  // تعيين ساعات ودقائق اليوم الحالي
//     return date;  // إرجاع الكائن DateTime
// }

// // دالة لحساب وقت نهاية الخدمة بناءً على المدة
// function getEndTime(start_time, duration) {
//     let end_time = new Date(start_time);  // نسخ الوقت الأصلي
//     // إضافة المدة (30 دقيقة أو 60 دقيقة) حسب المدة المحددة للخدمة
//     end_time.setMinutes(start_time.getMinutes() + (duration === "30 دقيقة" ? 30 : 60));
//     return end_time;  // إرجاع وقت النهاية
// }