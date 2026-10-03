# PaddleOCR service

This CPU-based Python service runs PaddleOCR outside the Next.js process. The reusable browser component and TypeScript client live in `app/component/ocr`; Next.js authenticates the signed-in Supabase user and proxies uploads to this service using a server-only API key.

## Local setup (Windows PowerShell)

Use Python 3.10–3.13 (Python 3.13 is installed in the current development environment), then from the repository root:

```powershell
py -3.13 -m venv ocr-service\.venv
ocr-service\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install paddlepaddle==3.2.0 -i https://www.paddlepaddle.org.cn/packages/stable/cpu/
python -m pip install -r ocr-service\requirements.txt
```

PaddlePaddle downloads CPU model files the first time OCR runs, so the first request can take longer and requires internet access.

Generate one random secret and set the same value in both processes:

```powershell
$secret = node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
$env:PADDLEOCR_API_KEY = $secret
```

Add these server-only values to `.env.local` for Next.js, using the generated secret:

```dotenv
PADDLEOCR_SERVICE_URL=http://127.0.0.1:8000
PADDLEOCR_SERVICE_API_KEY=<same-secret-as-PADDLEOCR_API_KEY>
```

Do not prefix either variable with `NEXT_PUBLIC_`. Keep the backend secret available in the terminal where Uvicorn runs as `PADDLEOCR_API_KEY`.

Start the OCR API in one terminal:

```powershell
uvicorn app.main:app --app-dir ocr-service --host 127.0.0.1 --port 8000
```

Start Next.js in another terminal with `npm run dev`. The OCR API health check is `http://127.0.0.1:8000/health`.

`OCR_LANG` defaults to `en`. Change it in the OCR service environment only to a language supported by the installed PaddleOCR models. The service accepts up to three JPEG, PNG, WEBP, BMP, TIFF, or PDF files in one request, with a combined limit of 10 MB; uploaded files are deleted after processing.

OCR line results include text and confidence, with an optional `box` polygon of `[x, y]` points. The reusable product-text extractor in `lib/ocr/productTextExtractor.ts` uses these coordinates to find a prominent product name and nearby Generic text.

The product camera scanner captures three frames about 450 ms apart, stores them temporarily in browser IndexedDB, and posts them together to the authenticated OCR endpoint. The local copies are cleared after processing, and the camera images are not shown or saved as product attachments. Backend inference time depends on the OCR service and hardware.

## Reuse in application pages

```tsx
import { PaddleOcrUpload } from "@/app/component/ocr";
```

Use `<PaddleOcrUpload onResult={(result) => ...} />` wherever OCR is needed. The `recognizeWithPaddleOcr` function and `OcrResult` type can also be imported from the same module for custom interfaces.
