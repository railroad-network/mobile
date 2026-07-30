/**
 * Create a listing (T1.7.2) — the seller-side flow, the first mobile *write* to
 * the marketplace. A member fills in an offer over a few steps and signs it on
 * the phone; the station verifies the signature and that the signer is the
 * provider, then publishes it (see `wallet/listing.ts` and the station's
 * `submit_listing`).
 *
 * The form is a plain step machine over one `Draft` in `useState` — the app's
 * existing forms (Send, onboarding) work this way, and a listing has no
 * cross-field validation a form library would earn. Each step validates only
 * what it collects; the station is the authority on the whole (it re-runs
 * `Listing::validate`), so this is a courtesy that catches the obvious before a
 * round trip, not the enforcement point.
 *
 * Two things kept deliberately simple for this pass: the reputation floor is a
 * whole number (the signed encoder is float-free — see `wallet/listing.ts`), and
 * there is no expiry field yet (a listing stands until closed; the CLI sets
 * expiries). Editing an existing listing is T1.7.2 Phase B.
 */
import {useMemo, useState} from 'react';
import {Pressable, ScrollView, StyleSheet, Switch, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {Amount, Badge, Button, Card, Field, ScreenHeader, Text} from '../../components';
import {parseCommons} from '../../ledger';
import {
  CATEGORIES,
  SURFACES,
  categoryLabel,
  useCreateListing,
  type ListingAvailabilityStatus,
  type ListingDraft,
  type ListingSurface,
} from '../../marketplace';
import {useTheme, type Theme} from '../../theme';
import type {MainStackScreenProps} from '../../navigation/types';

/** The ordered steps of the flow. */
const STEPS = [
  'surface',
  'basics',
  'category',
  'pricing',
  'availability',
  'requirements',
  'review',
] as const;
type Step = (typeof STEPS)[number];

/** The reputation floors a provider may ask for — whole numbers only (the signed
 * encoder is float-free). Bounded by the ~2.75 reachable ceiling, so the useful
 * choices are "anyone" and "an established member". */
const REPUTATION_CHOICES: {label: string; value: number; hint: string}[] = [
  {label: 'Anyone', value: 0, hint: 'No standing required'},
  {label: 'Member +', value: 2, hint: 'At least Member-band standing'},
];

const AVAILABILITY_CHOICES: {label: string; value: ListingAvailabilityStatus}[] = [
  {label: 'Available', value: 'available'},
  {label: 'Limited', value: 'limited_stock'},
  {label: 'Unavailable', value: 'unavailable'},
];

/** The working form state — a superset of {@link ListingDraft} with UI-only fields. */
interface FormState {
  surface: ListingSurface;
  title: string;
  description: string;
  category: string | null;
  amountText: string;
  isSubsidy: boolean; // Commons only: the provider pays the taker.
  negotiable: boolean;
  availabilityStatus: ListingAvailabilityStatus;
  capacityText: string; // Goods
  nextSlotText: string; // Services, YYYY-MM-DD
  minReputation: number;
  communityMemberOnly: boolean;
  oracleTier: number | null; // null → use the price-based suggestion
}

const INITIAL: FormState = {
  surface: 'goods',
  title: '',
  description: '',
  category: null,
  amountText: '',
  isSubsidy: false,
  negotiable: false,
  availabilityStatus: 'available',
  capacityText: '',
  nextSlotText: '',
  minReputation: 0,
  communityMemberOnly: false,
  oracleTier: null,
};

/** Tier 1 under 5 Commons, Tier 2 from 5 to 50 (the M1.8.2 ladder, from the price). */
function suggestedTier(amountCenti: number): number {
  return Math.abs(amountCenti) < 500 ? 1 : 2;
}

/** Parses the amount as signed centi, honouring the Commons subsidy toggle. */
function amountCentiOf(form: FormState): {centi: number} | {error: string} {
  const trimmed = form.amountText.trim();
  if (form.surface === 'commons' && trimmed.length === 0) {
    return {centi: 0}; // a free Commons offering
  }
  const parsed = parseCommons(trimmed);
  if ('error' in parsed) {
    return parsed;
  }
  return {centi: form.isSubsidy ? -parsed.centi : parsed.centi};
}

/** Parses a YYYY-MM-DD date to Unix seconds (local midnight), or an error. */
function parseDate(input: string): {seconds: number} | {error: string} {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.trim());
  if (m === null) {
    return {error: 'Use a date like 2026-08-15.'};
  }
  const [, y, mo, d] = m;
  const date = new Date(Number(y), Number(mo) - 1, Number(d));
  if (Number.isNaN(date.getTime())) {
    return {error: 'That isn’t a real date.'};
  }
  return {seconds: Math.floor(date.getTime() / 1000)};
}

export function CreateListing({navigation}: MainStackScreenProps<'CreateListing'>) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const createListing = useCreateListing();

  const [form, setForm] = useState<FormState>(INITIAL);
  const [stepIndex, setStepIndex] = useState(0);
  const [error, setError] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);

  const step = STEPS[stepIndex];
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm(f => ({...f, [key]: value}));

  const draft = useMemo(() => buildDraft(form), [form]);

  // Which steps apply to the chosen surface: Commons has no capacity/slot.
  const stepError = validateStep(step, form);

  const goNext = () => {
    if (stepError !== undefined) {
      setError(stepError);
      return;
    }
    setError(undefined);
    setStepIndex(i => Math.min(i + 1, STEPS.length - 1));
  };
  const goBack = () => {
    setError(undefined);
    if (stepIndex === 0) {
      navigation.goBack();
    } else {
      setStepIndex(i => i - 1);
    }
  };

  const publish = async () => {
    if ('error' in draft) {
      setError(draft.error);
      return;
    }
    setSubmitting(true);
    setError(undefined);
    const result = await createListing(draft.draft);
    setSubmitting(false);
    if (result.ok) {
      navigation.goBack();
    } else {
      setError(result.message);
    }
  };

  return (
    <View style={[styles.fill, {backgroundColor: theme.colors.bg}]}>
      <ScrollView
        style={styles.fill}
        contentContainerStyle={{
          paddingTop: insets.top + theme.spacing.sm,
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: theme.spacing.xl,
          gap: theme.spacing.lg,
        }}
        keyboardShouldPersistTaps="handled">
        <ScreenHeader
          title="New listing"
          subtitle={`Step ${stepIndex + 1} of ${STEPS.length}`}
          onBack={goBack}
          backLabel={stepIndex === 0 ? 'Cancel' : 'Back'}
        />
        <ProgressDots theme={theme} count={STEPS.length} active={stepIndex} />

        <StepBody theme={theme} step={step} form={form} set={set} />

        {error !== undefined && (
          <Text variant="caption" color={theme.colors.danger}>
            {error}
          </Text>
        )}
      </ScrollView>

      <View
        style={[
          styles.footer,
          {
            paddingHorizontal: theme.spacing.lg,
            paddingBottom: insets.bottom + theme.spacing.sm,
            paddingTop: theme.spacing.sm,
            borderTopColor: theme.colors.border,
            backgroundColor: theme.colors.bg,
          },
        ]}>
        {step === 'review' ? (
          <Button fullWidth onPress={publish} loading={submitting}>
            Publish listing
          </Button>
        ) : (
          <Button fullWidth onPress={goNext} disabled={submitting}>
            Continue
          </Button>
        )}
      </View>
    </View>
  );
}

/** Validates just what a step collects — the station re-validates the whole. */
function validateStep(step: Step, form: FormState): string | undefined {
  switch (step) {
    case 'basics':
      if (form.title.trim().length === 0) return 'Give your listing a title.';
      return undefined;
    case 'category':
      if (form.category === null) return 'Pick a category.';
      return undefined;
    case 'pricing': {
      const amount = amountCentiOf(form);
      if ('error' in amount) return amount.error;
      return undefined;
    }
    case 'availability':
      if (form.surface === 'goods' && form.capacityText.trim().length > 0) {
        if (!/^\d+$/.test(form.capacityText.trim())) return 'Capacity must be a whole number.';
      }
      if (form.surface === 'services' && form.nextSlotText.trim().length > 0) {
        const d = parseDate(form.nextSlotText);
        if ('error' in d) return d.error;
      }
      return undefined;
    default:
      return undefined;
  }
}

/** Assembles a signed-ready {@link ListingDraft}, or the first blocking error. */
function buildDraft(form: FormState): {draft: ListingDraft} | {error: string} {
  if (form.title.trim().length === 0) return {error: 'Give your listing a title.'};
  if (form.category === null) return {error: 'Pick a category.'};
  const amount = amountCentiOf(form);
  if ('error' in amount) return amount;

  let capacity: number | null = null;
  let nextSlot: number | null = null;
  if (form.surface === 'goods' && form.capacityText.trim().length > 0) {
    capacity = Number(form.capacityText.trim());
  }
  if (form.surface === 'services' && form.nextSlotText.trim().length > 0) {
    const d = parseDate(form.nextSlotText);
    if ('error' in d) return d;
    nextSlot = d.seconds;
  }

  return {
    draft: {
      surface: form.surface,
      category: form.category,
      title: form.title.trim(),
      description: form.description,
      amountCenti: amount.centi,
      // "Negotiable" the model means the amount is an opening ask; a Fixed price
      // may still invite offers. Keep the model Fixed unless offers are invited,
      // matching how the station reads the two fields.
      pricingModel: form.negotiable ? 'negotiable' : 'fixed',
      negotiable: form.negotiable,
      availabilityStatus: form.availabilityStatus,
      capacity,
      nextSlot,
      minReputation: form.minReputation,
      communityMemberOnly: form.communityMemberOnly,
      oracleTier: form.oracleTier ?? suggestedTier(amount.centi),
      expiresAt: null,
    },
  };
}

// --- steps ------------------------------------------------------------------

function StepBody({
  theme,
  step,
  form,
  set,
}: {
  theme: Theme;
  step: Step;
  form: FormState;
  set: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
}) {
  switch (step) {
    case 'surface':
      return (
        <StepFrame theme={theme} title="What are you offering?" hint="Pick the marketplace it belongs in.">
          {SURFACES.map(s => (
            <ChoiceRow
              key={s.tag}
              theme={theme}
              label={s.label}
              hint={surfaceHint(s.tag)}
              selected={form.surface === s.tag}
              onPress={() => set('surface', s.tag)}
            />
          ))}
        </StepFrame>
      );
    case 'basics':
      return (
        <StepFrame theme={theme} title="Describe it" hint="A clear title, and any detail a taker needs.">
          <Field label="Title" value={form.title} onChangeText={t => set('title', t)} placeholder="e.g. Sourdough loaves" />
          <Field
            label="Description"
            value={form.description}
            onChangeText={t => set('description', t)}
            placeholder="Optional — terms, condition, how to arrange it"
            multiline
            containerStyle={{marginTop: theme.spacing.md}}
          />
        </StepFrame>
      );
    case 'category':
      return (
        <StepFrame theme={theme} title="Category" hint="Used to find your listing and to build your domain reputation.">
          <View style={styles.chips}>
            {CATEGORIES.map(c => (
              <SelectChip
                key={c}
                theme={theme}
                label={categoryLabel(c)}
                selected={form.category === c}
                onPress={() => set('category', c)}
              />
            ))}
          </View>
        </StepFrame>
      );
    case 'pricing':
      return <PricingStep theme={theme} form={form} set={set} />;
    case 'availability':
      return <AvailabilityStep theme={theme} form={form} set={set} />;
    case 'requirements':
      return <RequirementsStep theme={theme} form={form} set={set} />;
    case 'review':
      return <ReviewStep theme={theme} form={form} />;
  }
}

function PricingStep({
  theme,
  form,
  set,
}: {
  theme: Theme;
  form: FormState;
  set: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
}) {
  return (
    <StepFrame
      theme={theme}
      title="Price"
      hint={
        form.surface === 'commons'
          ? 'Commons offers can be free, or a subsidy you pay the taker.'
          : 'What it costs, in Commons.'
      }>
      <Field
        label="Amount"
        value={form.amountText}
        onChangeText={t => set('amountText', t)}
        placeholder={form.surface === 'commons' ? '0.00 (leave blank for free)' : 'e.g. 3.50'}
        keyboardType="decimal-pad"
      />
      {form.surface === 'commons' && (
        <ToggleRow
          theme={theme}
          label="This is a subsidy"
          hint="You pay the taker for taking it on."
          value={form.isSubsidy}
          onValueChange={v => set('isSubsidy', v)}
        />
      )}
      <ToggleRow
        theme={theme}
        label="Invite offers"
        hint="Takers can propose a different price."
        value={form.negotiable}
        onValueChange={v => set('negotiable', v)}
      />
    </StepFrame>
  );
}

function AvailabilityStep({
  theme,
  form,
  set,
}: {
  theme: Theme;
  form: FormState;
  set: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
}) {
  return (
    <StepFrame theme={theme} title="Availability" hint="Whether it can be taken up, and how much there is.">
      <View style={styles.chips}>
        {AVAILABILITY_CHOICES.map(c => (
          <SelectChip
            key={c.value}
            theme={theme}
            label={c.label}
            selected={form.availabilityStatus === c.value}
            onPress={() => set('availabilityStatus', c.value)}
          />
        ))}
      </View>
      {form.surface === 'goods' && (
        <Field
          label="Units available"
          value={form.capacityText}
          onChangeText={t => set('capacityText', t)}
          placeholder="Optional — how many you have"
          keyboardType="number-pad"
          containerStyle={{marginTop: theme.spacing.md}}
        />
      )}
      {form.surface === 'services' && (
        <Field
          label="Next available slot"
          value={form.nextSlotText}
          onChangeText={t => set('nextSlotText', t)}
          placeholder="Optional — 2026-08-15"
          autoCapitalize="none"
          containerStyle={{marginTop: theme.spacing.md}}
        />
      )}
    </StepFrame>
  );
}

function RequirementsStep({
  theme,
  form,
  set,
}: {
  theme: Theme;
  form: FormState;
  set: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
}) {
  const suggested = suggestedTier(('centi' in amountCentiOf(form) ? (amountCentiOf(form) as {centi: number}).centi : 0));
  return (
    <StepFrame theme={theme} title="Who can take it" hint="What you ask of a taker. Optional.">
      <Text variant="label" color={theme.colors.textSecondary}>
        Minimum standing
      </Text>
      <View style={styles.chips}>
        {REPUTATION_CHOICES.map(c => (
          <SelectChip
            key={c.value}
            theme={theme}
            label={c.label}
            selected={form.minReputation === c.value}
            onPress={() => set('minReputation', c.value)}
          />
        ))}
      </View>
      <ToggleRow
        theme={theme}
        label="Community members only"
        hint="Only members of your community may take it up."
        value={form.communityMemberOnly}
        onValueChange={v => set('communityMemberOnly', v)}
      />
      <Text variant="label" color={theme.colors.textSecondary} style={{marginTop: theme.spacing.md}}>
        Dispute tier
      </Text>
      <Text variant="caption" color={theme.colors.textMuted}>
        Suggested Tier {suggested} for this price. Higher tiers cover larger deals.
      </Text>
      <View style={styles.chips}>
        {[1, 2].map(tier => (
          <SelectChip
            key={tier}
            theme={theme}
            label={`Tier ${tier}`}
            selected={(form.oracleTier ?? suggested) === tier}
            onPress={() => set('oracleTier', tier)}
          />
        ))}
      </View>
    </StepFrame>
  );
}

function ReviewStep({theme, form}: {theme: Theme; form: FormState}) {
  const amount = amountCentiOf(form);
  const centi = 'centi' in amount ? amount.centi : 0;
  return (
    <StepFrame theme={theme} title="Review" hint="This is how your listing will read. Publish when it’s right.">
      <Card style={{gap: theme.spacing.sm}}>
        <View style={styles.reviewTop}>
          <Text variant="label" color={theme.colors.text} style={styles.reviewTitle}>
            {form.title.trim().length > 0 ? form.title.trim() : 'Untitled'}
          </Text>
          {centi === 0 && form.surface === 'commons' ? (
            <Text variant="label" color={theme.colors.credit}>
              Free
            </Text>
          ) : (
            <View style={styles.reviewPrice}>
              {centi < 0 && (
                <Text variant="caption" color={theme.colors.textMuted}>
                  Subsidy
                </Text>
              )}
              <Amount centi={centi} signed={centi < 0} colored={false} size="sm" />
            </View>
          )}
        </View>
        <View style={styles.reviewMeta}>
          <Badge variant="neutral" size="sm">
            {form.surface.charAt(0).toUpperCase() + form.surface.slice(1)}
          </Badge>
          {form.category !== null && (
            <Text variant="caption" color={theme.colors.textSecondary}>
              {categoryLabel(form.category)}
            </Text>
          )}
          {form.negotiable && (
            <Text variant="caption" color={theme.colors.textMuted}>
              Negotiable
            </Text>
          )}
        </View>
        {form.description.trim().length > 0 && (
          <Text variant="body" color={theme.colors.textSecondary}>
            {form.description.trim()}
          </Text>
        )}
        {(form.minReputation > 0 || form.communityMemberOnly) && (
          <Text variant="caption" color={theme.colors.textMuted}>
            Requires{form.minReputation > 0 ? ` standing ${form.minReputation.toFixed(2)}` : ''}
            {form.minReputation > 0 && form.communityMemberOnly ? ' ·' : ''}
            {form.communityMemberOnly ? ' community members only' : ''}
          </Text>
        )}
      </Card>
    </StepFrame>
  );
}

// --- shared step chrome -----------------------------------------------------

function StepFrame({
  theme,
  title,
  hint,
  children,
}: {
  theme: Theme;
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <View style={{gap: theme.spacing.sm}}>
      <Text variant="headingSmall" color={theme.colors.text}>
        {title}
      </Text>
      <Text variant="body" color={theme.colors.textSecondary}>
        {hint}
      </Text>
      <View style={{gap: theme.spacing.sm, marginTop: theme.spacing.xs}}>{children}</View>
    </View>
  );
}

function ChoiceRow({
  theme,
  label,
  hint,
  selected,
  onPress,
}: {
  theme: Theme;
  label: string;
  hint: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{selected}}
      accessibilityLabel={label}
      style={[
        styles.choiceRow,
        {
          borderColor: selected ? theme.colors.primary : theme.colors.borderStrong,
          backgroundColor: selected ? theme.colors.primaryTint : theme.colors.surfaceRaised,
          borderRadius: theme.radius.lg,
        },
      ]}>
      <View style={styles.choiceText}>
        <Text variant="label" color={theme.colors.text}>
          {label}
        </Text>
        <Text variant="caption" color={theme.colors.textSecondary}>
          {hint}
        </Text>
      </View>
      <Text variant="body" color={selected ? theme.colors.primary : theme.colors.textMuted}>
        {selected ? '●' : '○'}
      </Text>
    </Pressable>
  );
}

function SelectChip({
  theme,
  label,
  selected,
  onPress,
}: {
  theme: Theme;
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{selected}}
      style={[
        styles.chip,
        {
          backgroundColor: selected ? theme.colors.text : theme.colors.surfaceRaised,
          borderColor: selected ? theme.colors.text : theme.colors.borderStrong,
        },
      ]}>
      <Text variant="label" numberOfLines={1} color={selected ? theme.colors.textInverse : theme.colors.textSecondary}>
        {label}
      </Text>
    </Pressable>
  );
}

function ToggleRow({
  theme,
  label,
  hint,
  value,
  onValueChange,
}: {
  theme: Theme;
  label: string;
  hint: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
}) {
  return (
    <View style={[styles.toggleRow, {marginTop: theme.spacing.sm}]}>
      <View style={styles.choiceText}>
        <Text variant="label" color={theme.colors.text}>
          {label}
        </Text>
        <Text variant="caption" color={theme.colors.textSecondary}>
          {hint}
        </Text>
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        accessibilityLabel={label}
        trackColor={{true: theme.colors.primary, false: theme.colors.borderStrong}}
      />
    </View>
  );
}

function ProgressDots({theme, count, active}: {theme: Theme; count: number; active: number}) {
  return (
    <View style={styles.dots} accessibilityLabel={`Step ${active + 1} of ${count}`}>
      {Array.from({length: count}).map((_, i) => (
        <View
          key={i}
          style={[
            styles.dot,
            {backgroundColor: i <= active ? theme.colors.primary : theme.colors.surfaceSunken},
          ]}
        />
      ))}
    </View>
  );
}

function surfaceHint(surface: ListingSurface): string {
  switch (surface) {
    case 'goods':
      return 'Physical items, with a quantity.';
    case 'services':
      return 'Labour and skills, with a next slot.';
    case 'commons':
      return 'Community-pooled resources, free or subsidised.';
  }
}

const styles = StyleSheet.create({
  fill: {flex: 1},
  footer: {borderTopWidth: 1},
  dots: {flexDirection: 'row', gap: 6, justifyContent: 'center'},
  dot: {width: 8, height: 8, borderRadius: 4},
  chips: {flexDirection: 'row', flexWrap: 'wrap', gap: 8},
  chip: {height: 36, paddingHorizontal: 14, borderRadius: 9999, borderWidth: 1, justifyContent: 'center'},
  choiceRow: {flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderWidth: 1},
  choiceText: {flex: 1, minWidth: 0, gap: 2},
  toggleRow: {flexDirection: 'row', alignItems: 'center', gap: 12},
  reviewTop: {flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12},
  reviewPrice: {alignItems: 'flex-end', gap: 2},
  reviewTitle: {flex: 1, minWidth: 0, fontWeight: '700'},
  reviewMeta: {flexDirection: 'row', alignItems: 'center', gap: 10},
});
