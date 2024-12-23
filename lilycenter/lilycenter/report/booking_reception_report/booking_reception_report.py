import frappe
from frappe import _
from datetime import datetime, timedelta

def execute(filters=None):
    """Main function to execute the report."""
    # Prepare columns
    columns = get_columns()

    # Fetch data
    data = get_data(filters)

    # Return results
    return columns, data

def get_columns():
    """Prepare report columns."""
    # First column for time range
    columns = [
        {
            "label": _("الوقت"), 
            "fieldname": "time_range", 
            "fieldtype": "Data", 
            "width": 150
        }
    ]

    # Fetch all categories from Item Group where Parent is "Beauty"
    categories = frappe.db.sql(""" 
        SELECT item_group_name 
        FROM `tabItem Group`
        WHERE parent_item_group = 'Beauty'
    """, as_dict=True)

    # Add each category as a column
    for category in categories:
        columns.append({
            "label": category["item_group_name"],
            "fieldname": category["item_group_name"],
            "fieldtype": "Data",
            "width": 200
        })

    return columns

def get_data(filters):
    """Fetch and organize booking data."""
    if not filters or not filters.get("date"):
        frappe.throw(_("يرجى اختيار التاريخ"))

    # Fetch bookings from the database
    bookings = frappe.db.sql("""
        SELECT 
            rs.time AS service_time,
            i.item_group AS category,
            b.customer,
            (SELECT employee_name FROM `tabEmployee` WHERE name = rs.worker) AS worker_name,
            rs.service_name
        FROM `tabBooking` b
        JOIN `tabReception Service` rs ON rs.parent = b.name
        JOIN `tabItem` i ON i.name = rs.service_name
        WHERE b.booking_date = %(date)s
        AND b.booking_status != 'ملغي'
        ORDER BY rs.time ASC
    """, {"date": filters.get("date")}, as_dict=True)

    # Generate all time slots for the day (00:00 to 23:00)
    time_slots = {}
    start_of_day = datetime.strptime('00:00', '%H:%M')
    end_of_day = datetime.strptime('23:00', '%H:%M')

    # Create time slots from 00:00 to 23:00
    current_time = start_of_day
    while current_time <= end_of_day:
        time_range = f"{current_time.strftime('%H:%M')} - {(current_time + timedelta(hours=1)).strftime('%H:%M')}"
        time_slots[time_range] = []  # Initialize an empty list for each time range
        current_time += timedelta(hours=1)

    # Organize bookings by hourly time slots
    for booking in bookings:
        # Ensure service_time is a datetime.time object
        service_time = booking["service_time"]
        if isinstance(service_time, timedelta):
            service_time = (datetime.min + service_time).time()  # Convert timedelta to time
        
        # Find the start of the hour for the service time
        start_of_hour = datetime.combine(datetime.min, service_time).replace(minute=0, second=0, microsecond=0)
        
        # Calculate the end time by adding 1 hour to the start time
        end_time = start_of_hour + timedelta(hours=1)
        
        # Format the time range
        time_range = f"{start_of_hour.strftime('%H:%M')} - {end_time.strftime('%H:%M')}"

        # Add booking details to the respective time slot
        time_slots[time_range].append({
            "category": booking["category"],
            "customer": booking["customer"],
            "worker_name": booking["worker_name"],
            "service_name": booking["service_name"]
        })

    # Prepare data for the report
    data = []
    for time_range, bookings in time_slots.items():
        # If there are multiple bookings in this time slot, create multiple rows
        for booking in bookings:
            row = {"time_range": time_range}
            row["customer"] = f"العميل: {booking['customer']}"
            row["worker_name"] = f"الموظف: {booking['worker_name']}"
            row["service_name"] = f"الخدمة: {booking['service_name']}"
            
            # Add category information
            for category in time_slots[time_range]:
                row[category['category']] = row.get(category['category'], "") + f"{booking['category']}: {booking['service_name']}<br>"
                
            data.append(row)

    return data
