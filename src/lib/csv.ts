/**
 * CSV parsing for the product importer.
 *
 * Hand-written rather than pulled from a package, because the input is a file
 * someone exported from Excel or Sheets and the failure modes are specific:
 * quoted fields containing commas and newlines, doubled quotes, a UTF-8 BOM
 * that Excel adds and that turns the first header into "\uFEFFname", and
 * Windows line endings.
 */

export type CsvRow = Record<string, string>;

/** RFC 4180 with the tolerances real exports need. */
export function parseCsv(input: string): { headers: string[]; rows: CsvRow[] } {
  // Excel prefixes UTF-8 files with a byte order mark. Left in place it becomes
  // part of the first header name and every column mapping silently misses.
  const text = input.replace(/^\uFEFF/, '');

  const records: string[][] = [];
  let field = '';
  let record: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"'; // an escaped quote
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      record.push(field);
      field = '';
    } else if (char === '\r') {
      // Swallow; the \n that follows ends the record.
    } else if (char === '\n') {
      record.push(field);
      records.push(record);
      record = [];
      field = '';
    } else {
      field += char;
    }
  }

  // Whatever is left when the input ends is the final record, unless the file
  // ended with a newline and there is nothing pending.
  if (field !== '' || record.length > 0) {
    record.push(field);
    records.push(record);
  }

  const nonEmpty = records.filter((r) => r.some((cell) => cell.trim() !== ''));
  if (nonEmpty.length === 0) return { headers: [], rows: [] };

  const headers = nonEmpty[0]!.map((h) => h.trim());
  const rows = nonEmpty.slice(1).map((cells) => {
    const row: CsvRow = {};
    headers.forEach((header, index) => {
      row[header] = (cells[index] ?? '').trim();
    });
    return row;
  });

  return { headers, rows };
}

// --- Column mapping ----------------------------------------------------------

export type ImportField =
  | 'name'
  | 'sku'
  | 'barcode'
  | 'description'
  | 'category'
  | 'supplier'
  | 'manufacturer'
  | 'unit'
  | 'price'
  | 'cost'
  | 'compare_at'
  | 'quantity'
  | 'min_quantity'
  | 'tags';

export const IMPORT_FIELDS: {
  key: ImportField;
  label: string;
  hint: string;
  required?: boolean;
  money?: boolean;
  integer?: boolean;
}[] = [
  { key: 'name', label: 'Product name', hint: 'The only column you must have', required: true },
  { key: 'sku', label: 'SKU', hint: 'Generated from the name if left out' },
  { key: 'barcode', label: 'Barcode', hint: '' },
  { key: 'description', label: 'Description', hint: 'Shown on the shop page' },
  { key: 'category', label: 'Category', hint: 'Created if it does not exist yet' },
  { key: 'supplier', label: 'Supplier', hint: 'Created if it does not exist yet' },
  { key: 'manufacturer', label: 'Manufacturer', hint: '' },
  { key: 'unit', label: 'Unit', hint: 'each, bag, loaf… defaults to each' },
  { key: 'price', label: 'Selling price', hint: '', money: true },
  { key: 'cost', label: 'Your cost', hint: '', money: true },
  { key: 'compare_at', label: '"Was" price', hint: 'For sale items', money: true },
  { key: 'quantity', label: 'Opening count', hint: 'Recorded as a stock receipt', integer: true },
  { key: 'min_quantity', label: 'Low-stock threshold', hint: '', integer: true },
  { key: 'tags', label: 'Tags', hint: 'Separated by commas or semicolons' },
];

/** Header spellings seen in real exports, normalised to compare loosely. */
const ALIASES: Record<ImportField, string[]> = {
  name: ['name', 'productname', 'product', 'title', 'item', 'itemname', 'description1'],
  sku: ['sku', 'code', 'itemcode', 'productcode', 'itemnumber', 'partnumber', 'id'],
  barcode: ['barcode', 'upc', 'ean', 'gtin', 'scancode'],
  description: ['description', 'details', 'longdescription', 'notes', 'about'],
  category: ['category', 'dept', 'department', 'group', 'type', 'section', 'aisle'],
  supplier: ['supplier', 'vendor', 'distributor', 'brandsupplier', 'suppliername'],
  manufacturer: ['manufacturer', 'brand', 'maker', 'producer'],
  unit: ['unit', 'uom', 'unitofmeasure', 'size', 'packsize', 'each'],
  price: ['price', 'sellprice', 'sellingprice', 'retail', 'retailprice', 'unitprice', 'msrp'],
  cost: ['cost', 'costprice', 'wholesale', 'wholesaleprice', 'buyprice', 'unitcost'],
  compare_at: ['compareat', 'wasprice', 'regularprice', 'listprice', 'rrp', 'originalprice'],
  quantity: ['quantity', 'qty', 'stock', 'onhand', 'stockonhand', 'soh', 'count', 'inventory'],
  min_quantity: ['minquantity', 'min', 'reorderpoint', 'reorderlevel', 'lowstock', 'minstock'],
  tags: ['tags', 'labels', 'keywords'],
};

const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Best guess at which column is which, so most files need no manual mapping. */
export function guessMapping(headers: string[]): Partial<Record<ImportField, string>> {
  const mapping: Partial<Record<ImportField, string>> = {};
  const taken = new Set<string>();

  for (const [field, aliases] of Object.entries(ALIASES) as [ImportField, string[]][]) {
    // Exact matches first across all fields, so a column called "price" is not
    // claimed by a fuzzy match from another field.
    const exact = headers.find((h) => !taken.has(h) && aliases.includes(normalize(h)));
    if (exact) {
      mapping[field] = exact;
      taken.add(exact);
    }
  }

  for (const [field, aliases] of Object.entries(ALIASES) as [ImportField, string[]][]) {
    if (mapping[field]) continue;
    const fuzzy = headers.find(
      (h) => !taken.has(h) && aliases.some((a) => normalize(h).includes(a) && a.length > 3),
    );
    if (fuzzy) {
      mapping[field] = fuzzy;
      taken.add(fuzzy);
    }
  }

  return mapping;
}

// --- Value parsing -----------------------------------------------------------

/**
 * Money out of a spreadsheet cell. Handles "$12.99", "12,99" (European),
 * "1,234.56", "(4.50)" for negatives, and blank.
 * Returns null when there is nothing usable, so a blank cell means "leave it"
 * rather than "set it to zero".
 */
export function parseMoneyToCents(raw: string): number | null {
  const text = raw.trim();
  if (text === '') return null;

  const negative = /^\(.*\)$/.test(text) || text.startsWith('-');
  let cleaned = text.replace(/[()]/g, '').replace(/[^0-9.,-]/g, '');
  if (cleaned === '' || cleaned === '-') return null;

  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');

  if (lastComma > lastDot) {
    // "1.234,56" — comma is the decimal separator.
    cleaned = cleaned.replace(/\./g, '').replace(',', '.');
  } else {
    // "1,234.56" — commas are thousands separators.
    cleaned = cleaned.replace(/,/g, '');
  }

  const value = Number(cleaned.replace(/-/g, ''));
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100) * (negative ? -1 : 1);
}

export function parseIntegerValue(raw: string): number | null {
  const text = raw.trim();
  if (text === '') return null;
  const value = Number(text.replace(/[^0-9.-]/g, ''));
  if (!Number.isFinite(value)) return null;
  return Math.round(value);
}

export function parseTags(raw: string): string[] {
  return raw
    .split(/[,;|]/)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 20);
}

export interface PreparedRow {
  index: number;
  name: string;
  values: Record<string, string | number | string[]>;
  errors: string[];
  warnings: string[];
}

/** Turns mapped spreadsheet rows into what import_products() expects. */
export function prepareRows(
  rows: CsvRow[],
  mapping: Partial<Record<ImportField, string>>,
): PreparedRow[] {
  const seenNames = new Map<string, number>();

  return rows.map((row, i) => {
    const get = (field: ImportField) => {
      const column = mapping[field];
      return column ? (row[column] ?? '') : '';
    };

    const errors: string[] = [];
    const warnings: string[] = [];
    const values: Record<string, string | number | string[]> = {};

    const name = get('name').trim();
    if (!name) errors.push('No product name');
    values.name = name;

    const lower = name.toLowerCase();
    if (name && seenNames.has(lower)) {
      warnings.push(`Same name as row ${seenNames.get(lower)}`);
    } else if (name) {
      seenNames.set(lower, i + 1);
    }

    for (const field of [
      'sku',
      'barcode',
      'description',
      'category',
      'supplier',
      'manufacturer',
      'unit',
    ] as const) {
      const raw = get(field).trim();
      if (raw) values[field] = raw;
    }

    for (const field of ['price', 'cost', 'compare_at'] as const) {
      const raw = get(field);
      if (raw.trim() === '') continue;
      const cents = parseMoneyToCents(raw);
      if (cents === null) {
        warnings.push(`Could not read ${field.replace('_', ' ')} "${raw}"`);
      } else if (cents < 0) {
        warnings.push(`Negative ${field.replace('_', ' ')} ignored`);
      } else {
        values[field] = cents;
      }
    }

    for (const field of ['quantity', 'min_quantity'] as const) {
      const raw = get(field);
      if (raw.trim() === '') continue;
      const value = parseIntegerValue(raw);
      if (value === null) {
        warnings.push(`Could not read ${field.replace('_', ' ')} "${raw}"`);
      } else if (value < 0) {
        warnings.push('Negative quantity ignored');
      } else {
        values[field] = value;
      }
    }

    const tags = get('tags');
    if (tags.trim()) values.tags = parseTags(tags);

    const price = values.price;
    const compare = values.compare_at;
    if (typeof price === 'number' && typeof compare === 'number' && compare <= price) {
      warnings.push('"Was" price is not above the selling price, so it was dropped');
      delete values.compare_at;
    }

    return { index: i + 1, name, values, errors, warnings };
  });
}

/** The starter file offered on the import screen. */
export const TEMPLATE_CSV = [
  'name,sku,category,supplier,unit,price,cost,quantity,min_quantity,barcode,description,tags',
  'Ambrosia Apples 2 lb,PRD-1001,Produce,Fraser Valley Growers,bag,5.49,2.80,140,20,0627843001001,"Crisp, low-acid, grown in Cawston.","fresh;local"',
  'Sourdough Loaf,,Bakery,Boundary Bay Bakehouse,loaf,6.99,2.90,42,10,,48-hour ferment.,bakery',
  'Olive Oil 750 ml,PRD-4001,Pantry,,bottle,22.99,11.80,74,10,,"Single estate, harvested last November.",pantry',
].join('\r\n');
