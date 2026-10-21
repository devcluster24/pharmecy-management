import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";

export const runtime = "nodejs";

type Row = Record<string, unknown>;
type Sheet = { name: string; columns: string[]; rows: unknown[][] };
type Settings = {
  owner_user_id: string;
  drive_folder_id: string | null;
  interval_days: number;
  auto_backup_enabled: boolean;
  products_exported_at: string | null;
};
type EncryptedToken = {
  refresh_token_ciphertext: string;
  refresh_token_iv: string;
  refresh_token_tag: string;
};

const appDataKeys = new Map<string, string>([
  ["sales", "pharmacy-sales-list-v1"],
  ["purchase", "pharmacy-purchase-list-v1"],
  ["place", "pharmacy-place-order-list-v1"],
  ["expenses", "pharmacy-expenses-v1"],
  ["returns", "pharmacy-return-records-v1"],
  ["threshold", "pharmacy-low-stock-threshold-v1"],
  ["supplierStatus", "pharmacy-supplier-status-v1"],
  ["supplierDueAdjustments", "pharmacy-supplier-due-adjustments-v1"],
  ["supplierDuePayments", "pharmacy-supplier-due-payments-v1"],
]);

function isRow(value: unknown): value is Row {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getRows(value: unknown): Row[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRow);
}

function asText(value: unknown) {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : 0;
}

function dateRange(sheets: Sheet[]) {
  let earliestTimestamp = Number.POSITIVE_INFINITY;
  let latestTimestamp = Number.NEGATIVE_INFINITY;
  for (const sheet of sheets) {
    const dateIndexes = sheet.columns
      .map((column, index) => (/date|time|created|updated|occurred|expiry/i.test(column) ? index : -1))
      .filter((index) => index >= 0);
    for (const row of sheet.rows) {
      for (const index of dateIndexes) {
        const timestamp = Date.parse(String(row[index] ?? ""));
        if (Number.isFinite(timestamp)) {
          earliestTimestamp = Math.min(earliestTimestamp, timestamp);
          latestTimestamp = Math.max(latestTimestamp, timestamp);
        }
      }
    }
  }
  const now = new Date();
  const earliest = Number.isFinite(earliestTimestamp) ? new Date(earliestTimestamp) : now;
  const latest = Number.isFinite(latestTimestamp) ? new Date(latestTimestamp) : now;
  const format = (date: Date) =>
    `${String(date.getDate()).padStart(2, "0")}.${String(date.getMonth() + 1).padStart(2, "0")}.${date.getFullYear()}`;
  return `${format(earliest)}-${format(latest)}`;
}

function workbookFile(baseName: string, sheets: Sheet[]) {
  const workbook = XLSX.utils.book_new();
  const usedNames = new Set<string>();
  for (const sheet of sheets) {
    const base = sheet.name.replace(/[:\\/?*\[\]\u0000-\u001f]/g, " ").trim().slice(0, 31) || "Sheet";
    let name = base;
    let suffix = 2;
    while (usedNames.has(name.toLocaleLowerCase())) {
      const suffixText = ` (${suffix++})`;
      name = `${base.slice(0, 31 - suffixText.length)}${suffixText}`;
    }
    usedNames.add(name.toLocaleLowerCase());
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      sheet.columns,
      ...sheet.rows.map((row) => row.map((cell) => cell ?? "")),
    ]), name);
  }
  return {
    name: `${baseName}_${dateRange(sheets)}.xlsx`,
    bytes: new Uint8Array(XLSX.write(workbook, { type: "array", bookType: "xlsx" })),
  };
}

function groupBy<T>(items: T[], getKey: (item: T) => string) {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = getKey(item);
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  return groups;
}

function sum(rows: Row[], key: string) {
  return rows.reduce((total, row) => total + asNumber(row[key]), 0);
}

function orderDate(rows: Row[], received = false) {
  const field = received ? "receivedAt" : "updatedAt";
  return rows.map((row) => asText(row[field]) || asText(row.orderDate)).sort().at(-1) ?? "";
}

function buildExports(data: Map<string, unknown>, products: Row[], staff: Row[], paymentHistory: Row[]) {
  const sales = getRows(data.get("sales"));
  const purchaseRows = getRows(data.get("purchase"));
  const placeRows = getRows(data.get("place"));
  const receivedRows = purchaseRows.filter((row) => row.status !== "Placed");
  const expenses = getRows(data.get("expenses"));
  const returns = getRows(data.get("returns"));
  const now = new Date();
  const threshold = asNumber(data.get("threshold"));
  const inventoryStatus = (row: Row) => {
    const quantityValue = row.availableQuantity === undefined ? row.quantity : row.availableQuantity;
    const quantity = quantityValue === undefined ? null : Number(quantityValue);
    if (quantity === null || !Number.isFinite(quantity)) return "Unknown quantity";
    if (quantity === 0) return "Out of stock";
    const expiry = asText(row.expDate);
    const expiryMonth = /^(\d{4})-(\d{2})$/.exec(expiry);
    if (expiryMonth) {
      const expiryTime = Number(expiryMonth[1]) * 12 + Number(expiryMonth[2]);
      const currentTime = now.getFullYear() * 12 + now.getMonth() + 1;
      if (expiryTime < currentTime) return "Expired";
      if (expiryTime - currentTime <= 3) return "Expiring soon";
    }
    if (threshold > 0 && quantity <= threshold) return "Low stock";
    return "In stock";
  };
  const getInventoryList = (list: string) => purchaseRows.filter((row) => {
    const status = inventoryStatus(row);
    if (list === "Inventory") return true;
    if (list === "Expire Soon") return status === "Expiring soon";
    if (list === "Expired") return status === "Expired";
    if (list === "Low Stock") return status === "Low stock";
    return status === "Out of stock";
  });
  const rowColumns = ["Date & Time", "Batch Number", "Order Number", "Supplier", "Brand Name", "Generic", "Strength", "Dosage Form", "Box Quantity", "Pack Size", "Total Quantity", "Pack Price", "Exp Date"];
  const inventorySheet = (name: string, rows: Row[]): Sheet => ({
    name,
    columns: rowColumns,
    rows: rows.map((row) => [
      asText(row.updatedAt) || asText(row.orderDate), row.batchNumber, row.order, row.supplier, row.brand,
      row.genericName, row.strength, row.dosageForm, row.quantity, row.packSize,
      row.availableQuantity ?? row.quantity, row.packPrice, row.expDate,
    ]),
  });
  const invoiceSheet: Sheet = {
    name: "Invoice",
    columns: ["Invoice", "Customer", "Phone", "Items", "Date & Time", "Subtotal", "Discount", "VAT/TAX", "Cash Rounding", "Total", "Paid", "Due", "Payment"],
    rows: sales.map((row) => [
      row.invoice, row.customer, row.phone, row.items, row.createdAt, row.subtotalAmount ?? row.amount,
      row.discountAmount ?? 0, row.taxAmount ?? 0, row.cashRoundingAmount ?? 0, row.amount,
      row.paidAmount ?? row.amount, row.dueAmount ?? 0, row.payment,
    ]),
  };

  const groupedPlace = [...groupBy(placeRows, (row) => asText(row.order)).entries()];
  const groupedReceive = [...groupBy(receivedRows, (row) => asText(row.order)).entries()];
  const purchaseSheets: Sheet[] = [
    {
      name: "Place Order List",
      columns: ["Date & Time", "Order", "Supplier", "Box Quantity", "Product Count", "Total Order Price"],
      rows: groupedPlace.map(([order, rows]) => [
        orderDate(rows), order, [...new Set(rows.map((row) => asText(row.supplier)))].join(", "),
        sum(rows, "quantity"), new Set(rows.map((row) => asText(row.brand).toLocaleLowerCase()).filter(Boolean)).size,
        sum(rows, "totalPrice"),
      ]),
    },
    {
      name: "Receive Order List",
      columns: ["Date & Time", "Order Number", "Supplier", "Supplier Name & Phone Number", "Total Purchase Amount"],
      rows: groupedReceive.map(([order, rows]) => [
        orderDate(rows, true), order, [...new Set(rows.map((row) => asText(row.supplier)))].join(", "),
        [...new Set(rows.map((row) => `${asText(row.supplierContactName)}${asText(row.supplierPhone) ? ` · ${asText(row.supplierPhone)}` : ""}`))].join(", "),
        sum(rows, "totalPrice"),
      ]),
    },
  ];
  const inventorySheets = ["Inventory", "Expire Soon", "Expired", "Low Stock", "Out of Stock"]
    .map((name) => inventorySheet(name, getInventoryList(name)));
  const returnSheet: Sheet = {
    name: "Returns",
    columns: ["Return ID", "Date & Time", "Customer", "Phone", "Re-Invoice", "Invoice", "Product", "Return Quantity", "Amount", "Net Refund", "Return Method"],
    rows: returns.map((row) => [
      row.returnId ?? row.id, row.date, row.customer || "Walk-in customer", row.phone,
      row.reInvoice, row.invoice, row.product, row.quantity, row.amount, row.netRefundAmount, row.returnMethod ?? "Cash Return",
    ]),
  };

  const customerGroups = [...groupBy(sales, (row) => `${asText(row.customer).toLocaleLowerCase()}\u0000${asText(row.phone).replace(/\D/g, "")}`).values()];
  const customerRows = customerGroups.map((rows) => {
    const latest = [...rows].sort((left, right) => Date.parse(asText(right.createdAt)) - Date.parse(asText(left.createdAt)))[0];
    return {
      name: asText(rows[0]?.customer).trim() || "Walk-in customer",
      phone: asText(rows[0]?.phone),
      latest: asText(latest?.createdAt),
      invoiceCount: rows.length,
      total: sum(rows, "amount"),
      paid: rows.reduce((total, row) => total + asNumber(row.paidAmount ?? row.amount), 0),
      due: rows.reduce((total, row) => total + Math.max(0, asNumber(row.dueAmount ?? asNumber(row.amount) - asNumber(row.paidAmount ?? row.amount))), 0),
    };
  });
  const supplierGroups = [...groupBy(receivedRows, (row) =>
    `${(asText(row.supplierContactName).trim() || `${asText(row.supplier).trim()} Distributor`).toLocaleLowerCase()}\u0000${asText(row.supplierPhone).replace(/\D/g, "")}`,
  ).values()];
  const customerSheets: Sheet[] = [
    {
      name: "Customer Management List",
      columns: ["Invoice", "Date & Time", "Customer", "Phone", "Items", "Subtotal", "Discount", "VAT/TAX", "Cash Rounding", "Total", "Paid", "Due", "Payment"],
      rows: sales.map((row) => [
        row.invoice, row.createdAt, row.customer, row.phone, row.items, row.subtotalAmount ?? row.amount,
        row.discountAmount ?? 0, row.taxAmount ?? 0, row.cashRoundingAmount ?? 0, row.amount,
        row.paidAmount ?? row.amount, row.dueAmount ?? 0, row.payment,
      ]),
    },
    {
      name: "Due Customer List",
      columns: ["Customer", "Phone", "Last Invoice Date", "Invoice Count", "Total Bill", "Total Paid", "Total Due"],
      rows: customerRows.filter((row) => row.due > 0).map((row) => [
        row.name, row.phone, row.latest, row.invoiceCount, row.total, row.paid, row.due,
      ]),
    },
  ];
  const supplierSheet: Sheet = {
    name: "Suppliers",
    columns: ["Supplier", "Phone", "Order Count", "Last Order Date", "Total Purchase", "Total Paid", "Total Due", "Status"],
    rows: supplierGroups.map((rows) => {
      const purchase = sum(rows, "totalPrice");
      const paid = asNumber(rows.find((row) => Number.isFinite(Number(row.orderPaidAmount)))?.orderPaidAmount);
      const name = asText(rows[0]?.supplierContactName).trim() || `${asText(rows[0]?.supplier).trim()} Distributor`;
      return [
        name, asText(rows[0]?.supplierPhone), new Set(rows.map((row) => asText(row.order))).size,
        orderDate(rows, true), purchase, paid, Math.max(0, purchase - paid),
        "Active",
      ];
    }),
  };
  const expenseSheet: Sheet = {
    name: "Expenses",
    columns: ["Date", "Category", "Description", "Payment Method", "Amount"],
    rows: expenses.map((row) => [row.date, row.category, row.description, row.paymentMethod, row.amount]),
  };
  const staffSheet: Sheet = {
    name: "Staff",
    columns: ["Full Name", "Email", "Role", "Status", "Created At"],
    rows: staff.map((row) => [row.full_name, row.email, row.staff_role, row.approval_status, row.created_at]),
  };
  const paymentSheet: Sheet = {
    name: "Payment History",
    columns: ["Date", "Invoice No.", "Plan", "Amount", "Payment Method", "Status"],
    rows: paymentHistory.map((row) => [row.occurred_at, row.invoice_number, row.plan_name, row.amount, row.payment_method, row.status]),
  };

  const salesTotal = sum(sales, "amount");
  const dueTotal = customerRows.reduce((total, row) => total + row.due, 0);
  const purchaseTotal = sum(receivedRows, "totalPrice");
  const refundTotal = sum(returns, "netRefundAmount") || sum(returns, "amount");
  const reportSheets: Sheet[] = [
    {
      name: "Sales Report",
      columns: ["Invoice", "Customer", "Date", "Items", "Total", "Discount", "VAT / TAX", "Cash rounding", "Paid to date", "Due", "Payment status"],
      rows: sales.map((row) => [
        row.invoice, row.customer, row.createdAt, row.items, row.amount, row.discountAmount ?? 0,
        row.taxAmount ?? 0, row.cashRoundingAmount ?? 0, row.paidAmount ?? row.amount,
        row.dueAmount ?? 0, row.payment,
      ]),
    },
    {
      name: "Customer Due",
      columns: ["Customer", "Phone", "Invoice count", "Total bill", "Paid", "Due", "Last invoice"],
      rows: customerRows.filter((row) => row.due > 0).map((row) => [
        row.name, row.phone, row.invoiceCount, row.total, row.paid, row.due, row.latest,
      ]),
    },
    {
      name: "Purchase Supplier",
      columns: ["Supplier", "Phone", "Order count", "Purchase", "Paid", "Due"],
      rows: supplierGroups.map((rows) => {
        const amount = sum(rows, "totalPrice");
        const paid = asNumber(rows.find((row) => Number.isFinite(Number(row.orderPaidAmount)))?.orderPaidAmount);
        return [
          asText(rows[0]?.supplierContactName) || asText(rows[0]?.supplier), asText(rows[0]?.supplierPhone),
          new Set(rows.map((row) => asText(row.order))).size, amount, paid, Math.max(0, amount - paid),
        ];
      }),
    },
    {
      name: "Stock Expiry",
      columns: ["Product", "Generic", "Batch", "Supplier", "Available quantity", "Expiry", "Status"],
      rows: purchaseRows.map((row) => [
        row.brand, row.genericName, row.batchNumber, row.supplierContactName || row.supplier,
        row.availableQuantity ?? row.quantity, row.expDate, inventoryStatus(row),
      ]),
    },
    {
      name: "Returns",
      columns: ["Return ID", "Date", "Customer", "Product", "Quantity", "Reason", "Method", "Item value", "Net refund"],
      rows: returns.map((row) => [
        row.returnId ?? row.id, row.date, row.customer, row.product, row.quantity, row.reason,
        row.returnMethod, row.amount, row.netRefundAmount ?? row.amount,
      ]),
    },
    {
      name: "Profit Loss",
      columns: ["Profit & Loss item", "Amount", "Explanation"],
      rows: [
        ["Sales revenue", salesTotal, `${sales.length} invoices`],
        ["Customer returns", refundTotal, "Recorded returns"],
        ["Purchases received", purchaseTotal, "Purchases are not cost of goods sold"],
        ["Shop expenses", sum(expenses, "amount"), `${expenses.length} expenses`],
        ["Customer due", dueTotal, "Outstanding customer balances"],
      ],
    },
    {
      name: "Recorded Expenses",
      columns: expenseSheet.columns,
      rows: expenseSheet.rows,
    },
  ];

  return [
    { baseName: "Invoice", sheets: [invoiceSheet] },
    { baseName: "Purchase", sheets: purchaseSheets },
    { baseName: "Inventory", sheets: inventorySheets },
    { baseName: "Returns", sheets: [returnSheet] },
    { baseName: "Customers", sheets: customerSheets },
    { baseName: "Suppliers", sheets: [supplierSheet] },
    { baseName: "Reports", sheets: reportSheets },
    { baseName: "Expenses", sheets: [expenseSheet] },
    { baseName: "Staff", sheets: [staffSheet] },
    { baseName: "Payment_History", sheets: [paymentSheet] },
    {
      baseName: "Product_Management",
      sheets: [{
        name: "Product Management",
        columns: ["ID Number", "Brand Name", "Generic Name", "Company", "Product Type", "Category", "Strength", "Dosage Form", "Pack Size", "Unit", "Barcode", "Retail Price", "Unit Price", "Pack Price", "Usage Type", "DAR Code", "Medicine Type Category", "Registration Information"],
        rows: products.map((row) => [
          row.source_catalog_id ?? row.id, row.brand, row.generic_name, row.manufacturer, row.product_type,
          row.category, row.strength, row.dosage_form, row.pack_size, row.unit, row.barcode, row.retail_price,
          row.unit_price ?? row.retail_price, row.pack_price ?? "-", row.usage_type, row.dar_code,
          row.medicine_type_category, row.registration_information,
        ]),
      }],
    },
  ];
}

function getRequiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

async function decryptRefreshToken(settings: EncryptedToken) {
  const secret = getRequiredEnv("BACKUP_TOKEN_ENCRYPTION_KEY");
  if (!/^[a-f0-9]{64}$/i.test(secret)) throw new Error("Backup token encryption key is invalid.");
  const keyBytes = Uint8Array.from(secret.match(/.{2}/g) ?? [], (byte) => Number.parseInt(byte, 16));
  const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["decrypt"]);
  const ciphertext = Uint8Array.from(atob(settings.refresh_token_ciphertext), (char) => char.charCodeAt(0));
  const tag = Uint8Array.from(atob(settings.refresh_token_tag), (char) => char.charCodeAt(0));
  const payload = new Uint8Array(ciphertext.length + tag.length);
  payload.set(ciphertext);
  payload.set(tag, ciphertext.length);
  const iv = Uint8Array.from(atob(settings.refresh_token_iv), (char) => char.charCodeAt(0));
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, payload);
  return new TextDecoder().decode(plaintext);
}

async function getDriveAccessToken(refreshToken: string) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: getRequiredEnv("BACKUP_GOOGLE_CLIENT_ID"),
      client_secret: getRequiredEnv("BACKUP_GOOGLE_CLIENT_SECRET"),
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const result: unknown = await response.json();
  if (!response.ok || !isRow(result)) {
    throw new Error("Could not refresh the Google Drive authorization. Reconnect Google Drive.");
  }
  const accessToken = result.access_token;
  if (typeof accessToken !== "string") {
    throw new Error("Could not refresh the Google Drive authorization. Reconnect Google Drive.");
  }
  return accessToken;
}

async function createDriveFolder(accessToken: string) {
  const folderName = `Backup_${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const response = await fetch("https://www.googleapis.com/drive/v3/files?fields=id", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      name: folderName,
      mimeType: "application/vnd.google-apps.folder",
    }),
  });
  const result: unknown = await response.json();
  if (!response.ok || !isRow(result) || typeof result.id !== "string") {
    throw new Error("Could not create the Google Drive backup folder.");
  }
  return result.id;
}

async function uploadDriveFile(accessToken: string, folderId: string, name: string, bytes: Uint8Array) {
  const boundary = `backup_${crypto.randomUUID()}`;
  const metadata = JSON.stringify({
    name,
    parents: [folderId],
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const prefix = new TextEncoder().encode(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n`,
  );
  const suffix = new TextEncoder().encode(`\r\n--${boundary}--`);
  const body = new Uint8Array(prefix.length + bytes.length + suffix.length);
  body.set(prefix);
  body.set(bytes, prefix.length);
  body.set(suffix, prefix.length + bytes.length);
  const response = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": `multipart/related; boundary=${boundary}` },
    body,
  });
  const result: unknown = await response.json();
  if (!response.ok || !isRow(result) || typeof result.id !== "string") {
    const detail = isRow(result) && isRow(result.error) ? asText(result.error.message) : "";
    throw new Error(detail || `Google Drive rejected ${name}.`);
  }
}

async function fetchOwnerData(service: SupabaseClient, ownerId: string) {
  const { data: appData, error } = await service
    .from("pharmacy_app_data")
    .select("data_key, payload")
    .eq("owner_user_id", ownerId);
  if (error) throw new Error("Could not load pharmacy data for backup.");
  const values = new Map<string, unknown>();
  for (const row of appData ?? []) {
    for (const [alias, key] of appDataKeys) {
      if (row.data_key === key || row.data_key === key.replace("pharmacy-", "pharmecy-")) {
        values.set(alias, row.payload);
      }
    }
  }

  const products: Row[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error: productsError } = await service
      .from("pharmacy_catalog_products")
      .select("id, source_catalog_id, brand, generic_name, manufacturer, product_type, category, strength, dosage_form, pack_size, unit, barcode, retail_price, unit_price, pack_price, usage_type, dar_code, medicine_type_category, registration_information")
      .eq("owner_user_id", ownerId)
      .order("id", { ascending: true })
      .range(offset, offset + 999);
    if (productsError) throw new Error("Could not load product data for backup.");
    products.push(...(data ?? []));
    if ((data ?? []).length < 1000) break;
  }

  const { data: invites, error: inviteError } = await service
    .from("pharmacy_staff_invites")
    .select("used_by")
    .eq("owner_user_id", ownerId)
    .not("used_by", "is", null);
  if (inviteError) throw new Error("Could not load staff data for backup.");
  const staffIds = [...new Set((invites ?? []).map((invite: { used_by?: unknown }) => invite.used_by).filter((id: unknown): id is string => typeof id === "string"))];
  let staff: Row[] = [];
  if (staffIds.length) {
    const [{ data: profiles, error: profilesError }, { data: permissions, error: permissionsError }] = await Promise.all([
      service.from("user_profiles").select("id, email, full_name, approval_status, created_at").in("id", staffIds),
      service.from("pharmacy_staff_permissions").select("staff_user_id, staff_role").eq("owner_user_id", ownerId),
    ]);
    if (profilesError || permissionsError) throw new Error("Could not read staff details for backup.");
    const roles = new Map<string, unknown>((permissions ?? []).map((row: { staff_user_id: string; staff_role: unknown }) => [row.staff_user_id, row.staff_role]));
    staff = (profiles ?? []).map((profile: Row) => ({
      ...profile,
      staff_role: roles.get(asText(profile.id)) ?? "Staff",
    }));
  }

  const { data: paymentHistory, error: historyError } = await service
    .from("pharmacy_subscription_payment_history")
    .select("invoice_number, plan_name, amount, payment_method, status, occurred_at")
    .eq("owner_user_id", ownerId)
    .order("occurred_at", { ascending: false });
  if (historyError) throw new Error("Could not load subscription payment history for backup.");
  return { data: values, products, staff, paymentHistory: paymentHistory ?? [] };
}

async function uploadBackup(service: SupabaseClient, settings: Settings) {
  const { data, products, staff, paymentHistory } = await fetchOwnerData(service, settings.owner_user_id);
  const exports = buildExports(data, products, staff, paymentHistory);
  const { data: encryptedToken, error: tokenError } = await service
    .from("pharmacy_drive_backup_secrets")
    .select("refresh_token_ciphertext, refresh_token_iv, refresh_token_tag")
    .eq("owner_user_id", settings.owner_user_id)
    .maybeSingle();
  if (tokenError || !encryptedToken) throw new Error("Connect Google Drive before creating a backup.");
  const accessToken = await getDriveAccessToken(await decryptRefreshToken(encryptedToken));
  let folderId = settings.drive_folder_id;
  if (!folderId) {
    folderId = await createDriveFolder(accessToken);
    const { error } = await service
      .from("pharmacy_drive_backup_settings")
      .update({ drive_folder_id: folderId, updated_at: new Date().toISOString() })
      .eq("owner_user_id", settings.owner_user_id);
    if (error) throw new Error("Drive folder was created but its ID could not be saved. Retry the backup.");
  }

  const uploaded: string[] = [];
  const failures: string[] = [];
  let productFileUploaded = false;
  for (const item of exports) {
    if (item.baseName === "Product_Management" && settings.products_exported_at) continue;
    const file = workbookFile(item.baseName, item.sheets);
    try {
      await uploadDriveFile(accessToken, folderId, file.name, file.bytes);
      uploaded.push(file.name);
      if (item.baseName === "Product_Management") productFileUploaded = true;
    } catch (error) {
      failures.push(`${file.name}: ${error instanceof Error ? error.message : "Upload failed."}`);
    }
  }
  if (productFileUploaded) {
    const { error } = await service
      .from("pharmacy_drive_backup_settings")
      .update({ products_exported_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("owner_user_id", settings.owner_user_id);
    if (error) failures.push("Product Management upload succeeded, but its one-time completion marker could not be saved.");
  }

  const status = failures.length === 0 ? "Success" : uploaded.length ? "Partial" : "Failed";
  const message = failures.join(" | ");
  const details = [
    ...uploaded,
    ...(settings.products_exported_at ? ["Product Management (skipped: already backed up)"] : []),
  ];
  const { error: logError } = await service.from("pharmacy_drive_backup_history").insert({
    owner_user_id: settings.owner_user_id,
    details,
    status,
    message,
  });
  if (logError) throw new Error("Backup files were uploaded, but the history record could not be saved.");
  return { status, message, details };
}

async function runForOwner(service: SupabaseClient, settings: Settings, auto: boolean) {
  const { data: claimed, error: claimError } = await service.rpc("claim_pharmacy_drive_backup", {
    requested_owner_id: settings.owner_user_id,
  });
  if (claimError) throw new Error("Could not lock this backup job.");
  if (claimed !== true) return { status: "Skipped", message: "A backup is already running." };

  try {
    const result = await uploadBackup(service, settings);
    if (auto) {
      const nextRun = new Date(Date.now() + settings.interval_days * 24 * 60 * 60 * 1000).toISOString();
      const { error } = await service
        .from("pharmacy_drive_backup_settings")
        .update({ next_backup_at: nextRun, updated_at: new Date().toISOString() })
        .eq("owner_user_id", settings.owner_user_id);
      if (error) throw new Error("Backup completed, but the next automatic run could not be scheduled.");
    }
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Backup failed.";
    await service.from("pharmacy_drive_backup_history").insert({
      owner_user_id: settings.owner_user_id,
      details: [],
      status: "Failed",
      message,
    });
    if (auto) {
      await service
        .from("pharmacy_drive_backup_settings")
        .update({
          next_backup_at: new Date(Date.now() + settings.interval_days * 24 * 60 * 60 * 1000).toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("owner_user_id", settings.owner_user_id);
    }
    throw error;
  } finally {
    await service.rpc("release_pharmacy_drive_backup", { requested_owner_id: settings.owner_user_id });
  }
}

export async function POST(request: Request) {
  if (request.method !== "POST") return Response.json({ error: "Method not allowed." }, { status: 405 });
  const supabaseUrl = getRequiredEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceKey = getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  const service = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const cronSecret = process.env.BACKUP_CRON_SECRET;
  const isCron = Boolean(cronSecret && request.headers.get("x-backup-cron-secret") === cronSecret);

  if (isCron) {
    const { data: dueSettings, error } = await service
      .from("pharmacy_drive_backup_settings")
      .select("owner_user_id, drive_folder_id, interval_days, auto_backup_enabled, products_exported_at")
      .eq("auto_backup_enabled", true)
      .lte("next_backup_at", new Date().toISOString())
      .limit(25);
    if (error) return Response.json({ error: "Could not read due backup schedules." }, { status: 500 });
    const results = [];
    for (const settings of (dueSettings ?? []) as Settings[]) {
      try {
        results.push({ owner: settings.owner_user_id, ...(await runForOwner(service, settings, true)) });
      } catch (error) {
        results.push({ owner: settings.owner_user_id, status: "Failed", message: error instanceof Error ? error.message : "Backup failed." });
      }
    }
    return Response.json({ results });
  }

  const authorization = request.headers.get("authorization") ?? "";
  const accessToken = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!accessToken) return Response.json({ error: "Sign in to start a backup." }, { status: 401 });
  const userClient = createClient(supabaseUrl, getRequiredEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"), {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
  const { data: userResult, error: authError } = await userClient.auth.getUser(accessToken);
  if (authError || !userResult.user) return Response.json({ error: "Your session is invalid or expired." }, { status: 401 });

  const { data: profile, error: profileError } = await service
    .from("user_profiles")
    .select("role, approval_status")
    .eq("id", userResult.user.id)
    .maybeSingle();
  if (profileError || profile?.role !== "pharmacy_user" || profile.approval_status !== "approved") {
    return Response.json({ error: "Only an approved pharmacy owner can create backups." }, { status: 403 });
  }
  const { data: settings, error: settingsError } = await service
    .from("pharmacy_drive_backup_settings")
    .select("owner_user_id, drive_folder_id, interval_days, auto_backup_enabled, products_exported_at")
    .eq("owner_user_id", userResult.user.id)
    .maybeSingle();
  if (settingsError || !settings) {
    return Response.json({ error: "Connect Google Drive before creating a backup." }, { status: 409 });
  }

  try {
    return Response.json(await runForOwner(service, settings as Settings, false));
  } catch (error) {
    return Response.json({ status: "Failed", message: error instanceof Error ? error.message : "Backup failed." }, { status: 500 });
  }
}
