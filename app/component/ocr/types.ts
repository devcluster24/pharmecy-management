export type OcrLine = {
  text: string;
  confidence: number | null;
  box?: number[][];
};

export type OcrPage = {
  page: number;
  lines: OcrLine[];
};

export type OcrResult = {
  text: string;
  pages: OcrPage[];
};
