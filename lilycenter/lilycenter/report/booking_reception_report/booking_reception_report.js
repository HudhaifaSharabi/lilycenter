frappe.query_reports["Booking Reception Report"] = {
   "filters": [
        {
            "fieldname": "date",
            "label": __("التاريخ"),
            "fieldtype": "Date",
            "reqd": 1,
            "default": frappe.datetime.get_today()
        }
    ],
    after_render: function(report) {
        // Apply custom CSS for multi-line cells
        const style = document.createElement("style");
        style.innerHTML = `
            .dt-cell--html {
                white-space: normal !important;
                word-break: break-word !important;
            }
        `;
        document.head.appendChild(style);

        // Add the custom class to HTML-rendering cells
        const datatable = report.datatable;
        datatable.wrapper.querySelectorAll("td").forEach(cell => {
            if (cell.innerHTML.includes("<br>")) {
                cell.classList.add("dt-cell--html");
            }
        });
    }
    
};
