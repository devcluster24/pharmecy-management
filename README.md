This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Browser-side product OCR

Product image OCR runs in the user's browser with PaddleOCR ONNX models and ONNX Runtime Web. It does not use a Python service or upload the image to an OCR API. The first scan downloads about 50 MB of model and runtime assets from this Vercel deployment; later scans can reuse the browser cache.

The current model setup is intended for English/Latin medicine labels. Bangla-script recognition is not included. OCR does not classify product fields or populate them automatically; recognized text lines are offered as selectable suggestions under each product field. Each scan checks the original and a lightly upscaled/sharpened/contrast-adjusted image, then displays the result with the higher average OCR confidence and suggests retaking a low-confidence image.

`npm install` and `npm ci` run `scripts/copy-ocr-runtime.mjs`, which copies the required ONNX Runtime Web WASM files into the ignored `public/ocr/runtime/` directory. The PaddleOCR model archives are self-hosted from `public/ocr/models/`, so production OCR does not depend on an external model server.

The `dev` and `build` scripts use Next.js Webpack because the OCR SDK's OpenCV dependency contains Node-only imports that Turbopack cannot resolve for the browser.

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
