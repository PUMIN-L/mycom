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

## Environment Variables

Make sure to set up your `.env.local` file with the following Cloudinary credentials:

```env
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret
```

## ⚠️ Important: Cloudinary PDF Configuration

By default, Cloudinary restricts the delivery of PDF and ZIP files (Strict Delivery) for security reasons. If your application uploads and displays PDF files (e.g., using `react-pdf`), you will encounter a `401 Unauthorized` (`deny or ACL failure`) error when trying to load them.

To fix this and allow PDFs to be viewed:

1. Log in to your Cloudinary Dashboard.
2. Go to **Settings** (Gear icon ⚙️).
3. Navigate to the **Security** tab.
4. Scroll down to the **Restricted media types** section.
5. **Uncheck** the box for **"Delivery of PDF and ZIP files"**.
6. Click **Save** at the bottom of the page.

Without this setting disabled, the application's PDF Viewer will not be able to load documents.
