import SubscriptionPaymentPage from "@/app/component/main/homepage/auth/SubscriptionPaymentPage";

export default async function PaymentPage({
  searchParams,
}: {
  searchParams: Promise<{ planId?: string | string[]; billingCycles?: string | string[] }>;
}) {
  const { planId, billingCycles } = await searchParams;
  const selectedPlanId = Array.isArray(planId) ? planId[0] : planId;
  const selectedBillingCycles = Array.isArray(billingCycles) ? billingCycles[0] : billingCycles;
  const parsedBillingCycles = Number(selectedBillingCycles ?? "1");

  return (
    <SubscriptionPaymentPage
      planId={selectedPlanId ?? ""}
      billingCycles={Number.isInteger(parsedBillingCycles) ? parsedBillingCycles : 0}
    />
  );
}
