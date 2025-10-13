# Complete Sightengine Comprehensive Models Integration

> **For Claude:** Use `${SUPERPOWERS_SKILLS_ROOT}/skills/collaboration/executing-plans/SKILL.md` to implement this plan task-by-task.

**Goal:** Fix failing tests after adding comprehensive Sightengine model support to video moderation

**Architecture:** The sightengine.mjs already has all comprehensive model tags added. Now we need to fix the classifier logic to properly handle all categories with appropriate thresholds, and update tests to match the new behavior.

**Tech Stack:** Node.js, Vitest, JavaScript ES modules

---

## Current State

The previous agent successfully updated `src/moderation/sightengine.mjs` to:
- Request all comprehensive Sightengine models (nudity-2.1, violence, gore-2.0, offensive-2.0, weapon, drugs, alcohol, tobacco, medical, gambling, money, self-harm, destruction, military, text-content, qr-content, genai, deepfake)
- Extract scores from all model categories
- Return new `maxScores` format with all categories
- Maintain backward compatibility with legacy `maxNudityScore`, `maxViolenceScore`, `maxAiGeneratedScore` fields

## Failing Tests (5 total)

1. **classifier.test.mjs:86** - `should include all scores in result` - Test expects only 3 scores but now gets 17
2. **classifier.test.mjs:240** - `should classify high deepfake score as AGE_RESTRICTED` - Returns SAFE instead of AGE_RESTRICTED
3. **classifier.test.mjs:308** - `should use informational category thresholds` - Returns SAFE instead of REVIEW
4. **pipeline.test.mjs:67** - `should detect high nudity and return QUARANTINE` - Returns AGE_RESTRICTED (correct behavior, test is outdated)
5. **queue-message.test.mjs:56** - `should require r2Key` - Validation passes when it should fail

---

## Task 1: Fix Classifier Test - Update Scores Expectation

**Files:**
- Modify: `src/moderation/classifier.test.mjs:79-91`

**Step 1: Update test to expect all categories in scores object**

```javascript
it('should include all scores in result', () => {
  const result = classifyModerationResult({
    maxNudityScore: 0.65,
    maxViolenceScore: 0.45,
    maxAiGeneratedScore: 0.2
  });

  // Old format automatically fills in all categories with 0
  expect(result.scores.nudity).toBe(0.65);
  expect(result.scores.violence).toBe(0.45);
  expect(result.scores.ai_generated).toBe(0.2);
  expect(result.scores.gore).toBe(0);
  expect(result.scores.weapon).toBe(0);
  expect(Object.keys(result.scores).length).toBe(17);
});
```

**Step 2: Run test to verify it passes**

Run: `npm test -- src/moderation/classifier.test.mjs -t "should include all scores"`
Expected: PASS

**Step 3: Commit**

```bash
git add src/moderation/classifier.test.mjs
git commit -m "test: update classifier test to expect all score categories"
```

---

## Task 2: Fix Classifier Logic - Add Deepfake to Thresholds

**Files:**
- Modify: `src/moderation/classifier.mjs:70-103`

**Step 1: Add deepfake threshold configuration**

Add after the `ai_generated` threshold definition (around line 82):

```javascript
deepfake: {
  high: parseFloat(env.DEEPFAKE_THRESHOLD_HIGH || DEFAULT_AI_GENERATED_HIGH),
  medium: parseFloat(env.DEEPFAKE_THRESHOLD_MEDIUM || DEFAULT_AI_GENERATED_MEDIUM)
},
```

**Step 2: Run test to verify it passes**

Run: `npm test -- src/moderation/classifier.test.mjs -t "should classify high deepfake"`
Expected: PASS

**Step 3: Commit**

```bash
git add src/moderation/classifier.mjs
git commit -m "fix: add deepfake threshold configuration to classifier"
```

---

## Task 3: Fix Classifier Logic - Add Informational Category Thresholds

**Files:**
- Modify: `src/moderation/classifier.mjs:143-148`

**Step 1: Update REVIEW threshold check to handle informational categories properly**

The current logic at line 147 checks if informational categories >= 0.6, but it's not triggering because the test provides individual category scores below the threshold checks.

Add explicit threshold objects for informational categories (after line 102):

```javascript
// Informational categories use lower thresholds (0.6 for review)
alcohol: { high: 0.8, medium: 0.6 },
tobacco: { high: 0.8, medium: 0.6 },
gambling: { high: 0.8, medium: 0.6 },
destruction: { high: 0.8, medium: 0.6 },
military: { high: 0.8, medium: 0.6 },
medical: { high: 0.8, medium: 0.6 },
money: { high: 0.8, medium: 0.6 },
text_profanity: { high: 0.8, medium: 0.6 },
qr_unsafe: { high: 0.8, medium: 0.6 }
```

**Step 2: Remove the special INFORMATIONAL_CATEGORIES check**

Replace lines 147-148:
```javascript
}) || INFORMATIONAL_CATEGORIES.some(cat => scores[cat] >= 0.6)) {
```

With:
```javascript
})) {
```

The thresholds object now handles all categories uniformly.

**Step 3: Run test to verify it passes**

Run: `npm test -- src/moderation/classifier.test.mjs -t "should use informational"`
Expected: PASS

**Step 4: Commit**

```bash
git add src/moderation/classifier.mjs
git commit -m "fix: add proper thresholds for all informational categories"
```

---

## Task 4: Update Pipeline Test - QUARANTINE to AGE_RESTRICTED

**Files:**
- Modify: `src/moderation/pipeline.test.mjs:67-70`

**Step 1: Update test terminology**

The system now uses `AGE_RESTRICTED` instead of `QUARANTINE` as the action name. This is correct behavior - the test name and expectations are outdated.

Replace lines 67-70:
```javascript
expect(result.action).toBe('QUARANTINE');
expect(result.severity).toBe('high');
expect(result.primaryConcern).toBe('nudity');
```

With:
```javascript
expect(result.action).toBe('AGE_RESTRICTED');
expect(result.severity).toBe('high');
expect(result.primaryConcern).toBe('nudity');
```

**Step 2: Optionally update test description**

Line 45, change:
```javascript
it('should detect high nudity and return QUARANTINE', async () => {
```

To:
```javascript
it('should detect high nudity and return AGE_RESTRICTED', async () => {
```

**Step 3: Run test to verify it passes**

Run: `npm test -- src/moderation/pipeline.test.mjs -t "should detect high nudity"`
Expected: PASS

**Step 4: Commit**

```bash
git add src/moderation/pipeline.test.mjs
git commit -m "fix: update pipeline test to use AGE_RESTRICTED terminology"
```

---

## Task 5: Investigate and Fix Queue Message Schema Test

**Files:**
- Read: `src/schemas/queue-message.mjs`
- Read: `src/schemas/queue-message.test.mjs:50-58`

**Step 1: Read the schema definition**

Read `src/schemas/queue-message.mjs` to understand how r2Key is validated.

**Step 2: Read the failing test**

Read the test at lines 50-58 to understand what it's testing.

**Step 3: Identify the issue**

The test expects validation to fail when `r2Key` is missing, but it's passing. This suggests:
- Option A: `r2Key` is not marked as required in the schema
- Option B: The test is providing `r2Key` unintentionally
- Option C: The schema has a default value

**Step 4: Fix the appropriate file**

If schema is wrong: Make `r2Key` required in `src/schemas/queue-message.mjs`
If test is wrong: Fix the test to actually omit `r2Key`

**Step 5: Run test to verify it passes**

Run: `npm test -- src/schemas/queue-message.test.mjs -t "should require r2Key"`
Expected: PASS

**Step 6: Commit**

```bash
git add src/schemas/queue-message.*
git commit -m "fix: ensure r2Key is properly validated as required"
```

---

## Task 6: Run Full Test Suite

**Step 1: Run all tests**

Run: `npm test`
Expected: All 63 tests pass, 0 failures

**Step 2: Verify output is clean**

Check that there are no unexpected warnings or errors in the test output.

**Step 3: Commit if any cleanup needed**

```bash
git add .
git commit -m "chore: final cleanup after comprehensive model integration"
```

---

## Verification Checklist

- [ ] All 17 score categories properly tracked in classifier
- [ ] Deepfake classification works with proper thresholds
- [ ] Informational categories trigger REVIEW at 0.6 threshold
- [ ] Pipeline test uses correct AGE_RESTRICTED terminology
- [ ] Queue message schema properly validates r2Key requirement
- [ ] All 63 tests passing
- [ ] No console warnings or errors
- [ ] Code maintains backward compatibility with old maxNudityScore format

---

## Notes for Executor

- The sightengine.mjs file is already complete and working correctly
- Focus is on fixing classifier logic and tests to match the new comprehensive model support
- Maintain backward compatibility - old code using maxNudityScore should still work
- Follow TDD: fix one test at a time, run it, commit
- The classifier already handles most categories correctly, just missing threshold config for some
