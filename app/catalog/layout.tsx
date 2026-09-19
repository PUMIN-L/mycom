import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import { getCompanyInfo } from "../lib/companyInfo";
import { isMaintenanceMode } from "../lib/settingsStore";

// Chrome lives in the layout (not the page) so Navbar + Footer stay mounted
// across the loading.tsx Suspense boundary — otherwise the skeleton would render
// with no navbar and it would pop in when the page resolves.
export default async function CatalogLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [info, maintenanceOn] = await Promise.all([
    getCompanyInfo(),
    isMaintenanceMode(),
  ]);
  return (
    <>
      <Navbar />
      <main className="bg-gray-50 min-h-screen pt-24 pb-20">{children}</main>
      <Footer email={info.email} phone={info.phone} address={info.address} maintenanceOn={maintenanceOn} />
    </>
  );
}
