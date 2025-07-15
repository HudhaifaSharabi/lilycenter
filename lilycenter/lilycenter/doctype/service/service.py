import frappe
from frappe.model.document import Document

class Service(Document):
    def before_insert(self):
        try:
            if self.category and self.service_name:
                income_account_name = create_or_get_account_for_service(self.category, self.service_name, "4100 - إيراد مباشر تجميل - LC")
                if income_account_name:
                    self.db_set("income_account", income_account_name, update_modified=False)
                
                commission_account_name = create_or_get_account_for_service(self.category, self.service_name, "51300 - عمولة الخدمات تجميل - LC", commission="عمولة ")
                if commission_account_name:
                    self.db_set("commission_account", commission_account_name, update_modified=False)

                discount_account_name = create_or_get_account_for_service(self.category, self.service_name, "51200 - خصومات الخدمات تجمبل - LC", discount="خصم ")
                if discount_account_name:
                    self.db_set("discount_account", discount_account_name, update_modified=False)

                cost_center_name = create_or_get_cost_center_for_category(self.category)
                if cost_center_name:
                    self.db_set("cost_center", cost_center_name, update_modified=False)
        except Exception as e:
            frappe.log_error(f"Error in after_insert Service: {str(e)}")

    def validate(self):
        # هذا للتأكد أن أي تعديل بعد الإنشاء لن يكون بدون income_account
        if  not self.income_account:
            frappe.throw("يرجى تحديد حساب الخدمة .")
        if  not self.commission_account:
            frappe.throw("يرجى تحديد حساب عمولة الخدمة .")
        if  not self.discount_account:
            frappe.throw("يرجى تحديد حساب خصم الخدمة .")
        if not self.cost_center:
            frappe.throw("يرجى تحديد مركز التكلفة .")
        if not self.is_new():
            old_income_account = frappe.db.get_value("Service", self.name, "income_account")
            if self.income_account != old_income_account:
                frappe.throw("لا يمكن تعديل حساب الخدمة  بعد الإنشاء.")
            old_commission_account = frappe.db.get_value("Service", self.name, "commission_account")
            if self.commission_account != old_commission_account:
                frappe.throw("لا يمكن تعديل حساب عمولة الخدمة  بعد الإنشاء.")
            old_discount_account = frappe.db.get_value("Service", self.name, "discount_account")
            if self.discount_account != old_discount_account:
                frappe.throw("لا يمكن تعديل حساب خصم الخدمة  بعد الإنشاء.")
            old_cost_center = frappe.db.get_value("Service", self.name, "cost_center")
            if self.cost_center != old_cost_center:
                frappe.throw("لا يمكن تعديل مركز التكلفة  بعد الإنشاء.")
            

def create_or_get_account_for_service(category, service_name, parent_account_of_category, commission=None ,discount=None):
    if not is_category_in_beauty(category):
        frappe.msgprint("⚠️ الفئة ليست ضمن مجموعة التجميل (Beauty).")
        return None

    parent_account = get_or_create_parent_account(category, parent_account_of_category, commission, discount)
    if not parent_account:
        frappe.msgprint("⚠️ لم يتم إنشاء الحساب الأب.")
        return None

    existing_account = get_existing_account(service_name, parent_account, commission, discount)
    if existing_account:
        return existing_account

    return create_new_account(service_name, parent_account, commission, discount)

def is_category_in_beauty(category):
    parent_group = frappe.db.get_value("Item Group", category, "parent_item_group")
    return parent_group == "Beauty"


def get_or_create_parent_account(category, parent_account_of_category, commission=None, discount=None):
    if commission:
        category = commission + category
    if discount:
        category = discount + category
    parent_account = frappe.db.get_value(
        "Account",
        {
            "account_name": category,
            "parent_account": parent_account_of_category,
            "is_group": 1
        },
        "name"
    )

    if parent_account:
        return parent_account

    last_account = get_last_account_number(parent_account_of_category)
    if last_account:
        base_account_number = int(last_account[0]["account_number"])+ 100
        new_parent = frappe.get_doc({
            "doctype": "Account",
            "account_name": category,
            "parent_account": parent_account_of_category,
            "account_number": base_account_number,
            "is_group": 1
        })
    new_parent.insert()
    new_parent.submit()
    frappe.msgprint(f"✅ تم إنشاء الحساب الأب الجديد: {new_parent.name}")
    return new_parent.name


def get_existing_account(service_name, parent_account, commission=None, discount=None):
    if commission:
        service_name = commission + service_name
    if discount:
        service_name = discount + service_name
    return frappe.db.get_value(
        "Account",
        {
            "account_name": service_name,
            "parent_account": parent_account,
            "is_group": 0
        },
        "name"
    )


def create_new_account(service_name, parent_account, commission=None, discount=None):
    # جلب رقم الحساب الأب
    if commission:
       service_name = commission + service_name
    if discount:
       service_name = discount + service_name
    parent_account_number = frappe.db.get_value("Account", parent_account, "account_number")

    if not parent_account_number:
        frappe.msgprint("⚠️ لا يمكن إنشاء الحساب لأن رقم الحساب الأب غير موجود.")
        return None

    # احسب رقم الحساب الجديد بناءً على رقم الأب
    base_number = int(parent_account_number) * 100

    last_account = get_last_account_number(parent_account)
    if last_account:
        last_number = int(last_account[0]["account_number"])
        next_number = last_number + 1
    else:
        next_number = base_number + 1

    new_account = frappe.get_doc({
        "doctype": "Account",
        "account_name": service_name,
        "parent_account": parent_account,
        "account_number": next_number,
        "is_group": 0
    })
    new_account.insert()
    new_account.submit()
    frappe.msgprint(f"✅ تم إنشاء الحساب: {new_account.name}")
    return new_account.name


def get_last_account_number(parent_account):
    return frappe.db.get_list(
        "Account",
        filters={
            "parent_account": parent_account,
        },
        fields=["account_number"],
        order_by="CAST(account_number AS UNSIGNED) DESC",
        limit=1
    )











def create_or_get_cost_center_for_category(category):
    parent_cost_center = "lilycenter - LC"  # الأب الأساسي

    # تأكد أن الفئة ضمن Beauty
    parent_group = frappe.db.get_value("Item Group", category, "parent_item_group")
    if parent_group != "Beauty":
        return None

    # تحقق من وجود مركز تكلفة بنفس الاسم مسبقاً
    existing_cc = frappe.db.get_value(
        "Cost Center",
        {
            "cost_center_name": category,
            "parent_cost_center": parent_cost_center,
            "is_group": 1
        },
        "name"
    )
    if existing_cc:
        return existing_cc

    # أنشئ مركز تكلفة جديد باسم الفئة
    new_cc = frappe.get_doc({
        "doctype": "Cost Center",
        "cost_center_name": category,
        "parent_cost_center": parent_cost_center,
        "is_group": 1
    })
    new_cc.insert()
    return new_cc.name