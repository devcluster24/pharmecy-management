import Papa from "papaparse";

type ProductFields = {
  medicineName: string;
  brand: string;
  genericName: string;
  manufacturer: string;
  productType: string;
  category: string;
  dosageForm: string;
  strength: string;
  packSize: string;
  unit: string;
  barcode: string;
};

export type ProductImportCandidate = ProductFields;
export type CsvSourceOption = { label: string; url: string };

const columnAliases: Record<keyof ProductFields, string[]> = {
  medicineName: ["medicine name", "product name", "item name", "medicine", "product", "name"],
  brand: ["brand", "brand name", "trade name", "tradename"],
  genericName: ["generic name", "generic", "genericname"],
  manufacturer: ["manufacturer", "manufacturer company", "company", "company name", "maker"],
  productType: ["product type", "type"],
  category: ["category", "therapeutic category"],
  dosageForm: ["dosage form", "dosageform", "form"],
  strength: ["strength", "medicine strength", "dose"],
  packSize: ["pack size", "packsize", "pack quantity", "package size"],
  unit: ["unit", "units"],
  barcode: ["barcode", "barcode gtin", "gtin", "ean", "upc"],
};

export function normalizeProductValue(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[\s\p{P}\p{S}]+/gu, "");
}

export function getProductNameKey(product: Pick<ProductFields, "medicineName">) {
  return normalizeProductValue(product.medicineName);
}

export function getProductIdentityKey(product: ProductFields) {
  const values = [product.medicineName, product.strength, product.dosageForm, product.manufacturer]
    .map(normalizeProductValue);
  return values.every(Boolean) ? JSON.stringify(values) : null;
}

export function parseProductCsv(csvText: string) {
  const parsed = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (header) => header.trim().toLocaleLowerCase("en-US"),
  });

  if (!parsed.meta.fields?.length) {
    throw new Error("CSV header row was not found.");
  }

  const headers = new Set(parsed.meta.fields.map(normalizeProductValue));
  const hasProductName = columnAliases.medicineName.some((alias) => headers.has(normalizeProductValue(alias)));
  if (!hasProductName) {
    throw new Error("Could not find a product name column. Use a header such as Product Name, Medicine Name, or Name.");
  }

  const rows: ProductImportCandidate[] = [];
  const warnings: string[] = [];

  parsed.data.forEach((row, index) => {
    const fields = Object.fromEntries(
      Object.entries(columnAliases).map(([field, aliases]) => {
        const aliasKeys = new Set(aliases.map(normalizeProductValue));
        const entry = Object.entries(row).find(([header]) => aliasKeys.has(normalizeProductValue(header)));
        return [field, entry?.[1]?.trim() ?? ""];
      }),
    ) as ProductFields;

    if (!fields.medicineName) {
      warnings.push(`CSV row ${index + 2} has no product name and was skipped.`);
      return;
    }

    rows.push({ ...fields, productType: fields.productType || "Medicine" });
  });

  const parserWarnings = parsed.errors.map((error) => `CSV row ${error.row === undefined ? "?" : error.row + 2}: ${error.message}`);
  return { rows, warnings: [...warnings, ...parserWarnings] };
}

function encodePath(path: string) {
  return path.split("/").map(encodeURIComponent).join("/");
}

export async function resolveCsvSources(source: string, signal?: AbortSignal): Promise<CsvSourceOption[]> {
  let sourceUrl: URL;
  try {
    sourceUrl = new URL(source.trim());
  } catch {
    throw new Error("Enter a valid HTTPS CSV/JSON or GitHub link.");
  }

  if (sourceUrl.protocol !== "https:" || sourceUrl.username || sourceUrl.password) {
    throw new Error("Only public HTTPS links are supported.");
  }

  if (sourceUrl.hostname === "raw.githubusercontent.com") {
    return [{ label: sourceUrl.pathname.split("/").pop() || "GitHub CSV", url: sourceUrl.href }];
  }

  if (sourceUrl.hostname !== "github.com") {
    return [{ label: sourceUrl.pathname.split("/").pop() || sourceUrl.hostname, url: sourceUrl.href }];
  }

  const segments = sourceUrl.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  const [owner, repository, viewType, ...viewPath] = segments;
  if (!owner || !repository) {
    throw new Error("Paste a GitHub repository link or a link to a CSV/JSON file.");
  }

  if (viewType === "blob") {
    const [branch, ...filePath] = viewPath;
    if (!branch || filePath.length === 0) {
      throw new Error("That GitHub file link is incomplete.");
    }
    const path = `${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/${encodeURIComponent(branch)}/${encodePath(filePath.join("/"))}`;
    return [{ label: filePath.at(-1) || "GitHub CSV", url: `https://raw.githubusercontent.com/${path}` }];
  }

  if (viewType && viewType !== "tree") {
    throw new Error("Open a GitHub repository or CSV/JSON file page, then paste its URL.");
  }

  const branch = viewType === "tree" ? viewPath[0] : undefined;
  const folder = viewType === "tree" ? viewPath.slice(1).join("/") : "";
  const repositoryResponse = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`, {
    headers: { Accept: "application/vnd.github+json" },
    signal,
  });
  if (!repositoryResponse.ok) {
    throw new Error("Could not read that public GitHub repository. Check the link and try a raw CSV link instead.");
  }

  const repositoryData = await repositoryResponse.json() as { default_branch?: string };
  const selectedBranch = branch || repositoryData.default_branch;
  if (!selectedBranch) {
    throw new Error("Could not determine the repository's default branch.");
  }

  const treeResponse = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/git/trees/${encodeURIComponent(selectedBranch)}?recursive=1`, {
    headers: { Accept: "application/vnd.github+json" },
    signal,
  });
  if (!treeResponse.ok) {
    throw new Error("Could not list files in that GitHub repository.");
  }

  const treeData = await treeResponse.json() as { truncated?: boolean; tree?: { path: string; type: string }[] };
  if (treeData.truncated) {
    throw new Error("The repository is too large to scan. Use a direct GitHub CSV file link.");
  }

  const candidates = (treeData.tree ?? [])
    .filter((item) => item.type === "blob" && /\.(csv|json)$/i.test(item.path))
    .filter((item) => !folder || item.path.startsWith(`${folder}/`))
    .map((item) => ({
      label: item.path,
      url: `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/${encodeURIComponent(selectedBranch)}/${encodePath(item.path)}`,
    }));

  if (candidates.length === 0) {
    throw new Error("No CSV or JSON data files were found at that repository or folder link.");
  }
  return candidates;
}
