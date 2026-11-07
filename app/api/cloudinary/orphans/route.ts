import { NextRequest, NextResponse } from "next/server";
import { requireAuth, withRoute } from "../../../lib/apiHelpers";
import {
  listAllCloudinaryAssets,
  extractPublicId,
} from "../../../lib/cloudinaryHelper";
import { getAllUsedImageUrls } from "../../../lib/imageUsageHelper";
import { getSetting, setSetting } from "../../../lib/settingsStore";
import { takeOtpAttempt, clearOtpAttempts } from "../../../lib/otpAttempts";
import { ORPHAN_DELETE_MAX } from "../../../lib/orphanDelete";

/**
 * GET /api/cloudinary/orphans  (admin only)
 *
 * Scans Cloudinary for all assets in the project folder and cross-references
 * them against the database. Returns the list of orphaned (unused) assets.
 */
export const GET = withRoute(
  "ตรวจหารูปที่ไม่ได้ใช้บน Cloudinary ไม่สำเร็จ",
  async () => {
    await requireAuth();

    // 1. Fetch all assets from Cloudinary
    const allAssets = await listAllCloudinaryAssets();

    // 2. Collect every Cloudinary URL in use in the DB
    const usedUrls = await getAllUsedImageUrls();

    // Build a secondary lookup by public_id (without extension) so we can
    // match even when the stored URL differs slightly from the Cloudinary
    // secure_url (e.g. different version segment or transformation).
    const usedPublicIds = new Set<string>();
    for (const url of usedUrls) {
      const pid = extractPublicId(url);
      if (pid) usedPublicIds.add(pid);
      // Also try with extension (raw assets like PDFs)
      const pidExt = extractPublicId(url, true);
      if (pidExt) usedPublicIds.add(pidExt);
    }

    // 3. Filter to orphaned assets
    const orphans = allAssets.filter((asset) => {
      // Check by exact secure_url match
      if (usedUrls.has(asset.secureUrl)) return false;
      // Check by public_id match (handles version/transform differences)
      const pidNoExt = asset.publicId.replace(/\.[^.]+$/, "");
      if (usedPublicIds.has(asset.publicId) || usedPublicIds.has(pidNoExt)) {
        return false;
      }
      return true;
    });

    return NextResponse.json({
      total: allAssets.length,
      inUse: allAssets.length - orphans.length,
      orphanCount: orphans.length,
      orphans,
    });
  }
);

/**
 * DELETE /api/cloudinary/orphans  (admin only)
 *
 * Deletes selected orphaned assets from Cloudinary.
 * Body: { items: { publicId: string; resourceType: string }[], otp: string }
 *
 * Requires a valid 6-digit OTP sent via POST /api/cloudinary/orphans/otp.
 * Each asset is double-checked against the DB before deletion as a safety net.
 *
 * At most ORPHAN_DELETE_MAX items, refused (400) rather than cut short, and
 * the answer names what happened to each — `deletedIds`, `skippedIds` (in use
 * again) and `errors` — so the screen removes only what is really gone.
 */
export const DELETE = withRoute(
  "ลบรูปที่ไม่ได้ใช้ไม่สำเร็จ",
  async (request: NextRequest) => {
    await requireAuth();

    const { items, otp } = await request.json();

    // ── OTP Verification ──────────────────────────────────────────────────
    if (!otp || typeof otp !== "string" || otp.length !== 6) {
      return NextResponse.json(
        { error: "กรุณากรอกรหัสยืนยัน 6 หลัก" },
        { status: 400 }
      );
    }

    // The list is checked BEFORE the code is compared or used up, so a request
    // this route refuses never costs the admin the emailed code.
    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { error: "ต้องระบุรายการรูป (items)" },
        { status: 400 }
      );
    }
    if (items.length > ORPHAN_DELETE_MAX) {
      return NextResponse.json(
        { error: `ลบได้ครั้งละไม่เกิน ${ORPHAN_DELETE_MAX} รูป` },
        { status: 400 }
      );
    }

    const savedOtp = await getSetting("orphan_delete_otp");
    const expiresAtStr = await getSetting("orphan_delete_otp_expires");
    const expiresAt = expiresAtStr ? parseInt(expiresAtStr, 10) : 0;

    if (!savedOtp) {
      // No code issued: nothing to guess at, so nothing is counted.
      return NextResponse.json({ error: "รหัสยืนยันไม่ถูกต้อง" }, { status: 403 });
    }
    // The guess is taken BEFORE comparing (takeOtpAttempt), so a burst of
    // parallel guesses gets five comparisons, not one each.
    const attempt = await takeOtpAttempt("orphan_delete_otp");
    const wrong = otp !== savedOtp;
    if (!attempt.allowed || (wrong && attempt.last)) {
      await setSetting("orphan_delete_otp", "");
      await setSetting("orphan_delete_otp_expires", "0");
      return NextResponse.json(
        { error: "กรอกรหัสยืนยันผิดเกินจำนวนที่กำหนด กรุณาขอรหัสใหม่" },
        { status: 403 }
      );
    }
    if (wrong) {
      return NextResponse.json({ error: "รหัสยืนยันไม่ถูกต้อง" }, { status: 403 });
    }

    if (Date.now() > expiresAt) {
      // Clear expired OTP
      await setSetting("orphan_delete_otp", "");
      await setSetting("orphan_delete_otp_expires", "0");
      return NextResponse.json(
        { error: "รหัสยืนยันหมดอายุแล้ว กรุณาขอรหัสใหม่" },
        { status: 403 }
      );
    }

    // OTP is valid — clear it so it can't be reused
    await setSetting("orphan_delete_otp", "");
    await setSetting("orphan_delete_otp_expires", "0");
    await clearOtpAttempts("orphan_delete_otp");

    // ── Deletion ──────────────────────────────────────────────────────────
    const deletedIds: string[] = [];
    const skippedIds: string[] = [];
    const errors: string[] = [];

    // Re-fetch used URLs for a fresh safety check
    const usedUrls = await getAllUsedImageUrls();
    const usedPublicIds = new Set<string>();
    for (const url of usedUrls) {
      const pid = extractPublicId(url);
      if (pid) usedPublicIds.add(pid);
      const pidExt = extractPublicId(url, true);
      if (pidExt) usedPublicIds.add(pidExt);
    }

    // Import cloudinary once, outside the loop
    const { v2: cloudinary } = await import("cloudinary");

    for (const item of items) {
      const { publicId, resourceType = "image" } = item ?? {};
      if (typeof publicId !== "string" || !publicId) continue;

      // Safety: Skip if the asset is now in use (race protection)
      const pidNoExt = publicId.replace(/\.[^.]+$/, "");
      if (usedPublicIds.has(publicId) || usedPublicIds.has(pidNoExt)) {
        skippedIds.push(publicId);
        continue;
      }

      try {
        const result = await cloudinary.uploader.destroy(publicId, {
          resource_type: resourceType,
        });
        if (result.result === "ok" || result.result === "not found") {
          deletedIds.push(publicId);
        } else {
          errors.push(`${publicId}: ${result.result}`);
        }
      } catch (err: any) {
        errors.push(`${publicId}: ${err.message}`);
      }
    }

    return NextResponse.json({
      deleted: deletedIds.length,
      skipped: skippedIds.length,
      failed: errors.length,
      deletedIds,
      skippedIds,
      errors: errors.length > 0 ? errors : undefined,
    });
  }
);
