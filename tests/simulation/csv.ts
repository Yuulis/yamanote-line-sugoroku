/** Research CSV dialect: commas, quoted newlines and doubled quote escapes. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let closedQuote = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char !== '"') field += char;
      else if (text[index + 1] === '"') { field += '"'; index += 1; }
      else { quoted = false; closedQuote = true; }
    } else if (char === "," || char === "\n") {
      row.push(field);
      field = "";
      closedQuote = false;
      if (char === "\n") { rows.push(row); row = []; }
    } else if (char === '"' && field === "" && !closedQuote) quoted = true;
    else {
      if (closedQuote || char === '"') throw new Error("Invalid CSV quoting");
      field += char;
    }
  }
  if (quoted) throw new Error("Unterminated CSV quote");
  if (field !== "" || row.length > 0 || closedQuote) rows.push([...row, field]);
  const headers = rows.shift();
  if (!headers || headers.some((key) => key === "") || new Set(headers).size !== headers.length) {
    throw new Error("Missing or duplicate CSV headers");
  }
  return rows.map((values, index) => {
    if (values.length !== headers.length) throw new Error(`CSV row ${index + 2}: wrong column count`);
    return Object.fromEntries(headers.map((key, column) => [key, values[column] ?? ""]));
  });
}

export function required(row: Record<string, string>, key: string): string {
  const value = row[key];
  if (!value) throw new Error(`Missing CSV value: ${key}`);
  return value;
}
