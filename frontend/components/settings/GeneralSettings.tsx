"use client";

import BankAccountsSection from "@/components/settings/BankAccountsSection";
import SubscriptionsSection from "@/components/settings/SubscriptionsSection";
import CustomCategoriesSection from "@/components/settings/CustomCategoriesSection";

/** General tab: the account, subscription and category settings that used to
 * be the whole Ajustes page. */
export default function GeneralSettings() {
  return (
    <>
      <BankAccountsSection />
      <SubscriptionsSection />
      <CustomCategoriesSection />
    </>
  );
}
