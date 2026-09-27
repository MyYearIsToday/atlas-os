import type {
  VisibilityInputs,
  VisibilityResult,
} from './atlas-data';

const WEIGHTS: Record<keyof VisibilityInputs, number> = {
  profileCompleteness: 0.2,
  reviews: 0.2,
  photos: 0.15,
  localSeo: 0.2,
  businessInfo: 0.15,
  engagement: 0.1,
};

export function calculateVisibilityScore(
  inputs: VisibilityInputs,
): VisibilityResult {
  const total = Math.round(
    Object.entries(inputs).reduce(
      (score, [key, value]) =>
        score + value * WEIGHTS[key as keyof VisibilityInputs],
      0,
    ),
  );

  const grade =
    total >= 90 ? 'Exceptional' :
    total >= 75 ? 'Strong' :
    total >= 60 ? 'Needs attention' :
    'At risk';

  const lowest = Object.entries(inputs).sort(([, left], [, right]) => left - right)[0];
  const labels: Record<keyof VisibilityInputs, string> = {
    profileCompleteness: 'profile completeness',
    reviews: 'reviews',
    photos: 'photos',
    localSeo: 'local SEO',
    businessInfo: 'business information',
    engagement: 'engagement',
  };

  return {
    ...inputs,
    total,
    grade,
    recommendation: `Prioritize ${labels[lowest[0] as keyof VisibilityInputs]} next to unlock the fastest score lift.`,
  };
}

export function scoreColor(score: number): string {
  if (score >= 80) return '#16A085';
  if (score >= 60) return '#D4AF37';
  return '#E98B6D';
}