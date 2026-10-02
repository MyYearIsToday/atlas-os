import { PageIntro } from '@/components/atlas-shell';
import { ManualBusinessForm } from '@/components/scout/manual-business-form';

export function ScoutPage() {
  return (
    <div>
      <PageIntro eyebrow="Scout" title="Manual Business Entry" description="Add a business you found yourself. It goes through the same discovery pipeline as automated Scout results." />
      <div className="card-glow max-w-3xl rounded-xl border border-[#233247] bg-[#0d1a2b]/90 p-5">
        <ManualBusinessForm />
      </div>
    </div>
  );
}
