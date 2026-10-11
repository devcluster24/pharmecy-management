import StaffSignupPage from "../../component/main/homepage/auth/StaffSignupPage";

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <StaffSignupPage token={token} />;
}
