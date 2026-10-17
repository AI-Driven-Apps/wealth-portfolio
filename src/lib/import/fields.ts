// Kept apart from spreadsheet.ts so the browser bundle doesn't pull in the Excel reader.
export const TXN_FIELDS: { field: string; label: string }[] = [
  { field: "date", label: "Date" }, { field: "type", label: "Type" }, { field: "name", label: "Fund / stock name" },
  { field: "symbol", label: "NSE symbol" }, { field: "isin", label: "ISIN" }, { field: "amfi", label: "AMFI code" },
  { field: "units", label: "Units" }, { field: "price", label: "Price / NAV" }, { field: "amount", label: "Amount" },
  { field: "fees", label: "Charges" }, { field: "account", label: "Folio / account" }, { field: "platform", label: "Platform" },
];
