// ABOUTME: Tests for content severity classification
// ABOUTME: Determines SAFE/REVIEW/QUARANTINE actions based on moderation scores

import { describe, it, expect } from 'vitest';
import { classifyModerationResult } from './classifier.mjs';

describe('Moderation Classifier', () => {
  it('should classify low scores as SAFE', () => {
    const result = classifyModerationResult({
      maxNudityScore: 0.1,
      maxViolenceScore: 0.05
    });

    expect(result.action).toBe('SAFE');
    expect(result.severity).toBe('low');
    expect(result.reason).toContain('safe');
  });

  it('should classify medium scores as REVIEW', () => {
    const result = classifyModerationResult({
      maxNudityScore: 0.65,
      maxViolenceScore: 0.3
    });

    expect(result.action).toBe('REVIEW');
    expect(result.severity).toBe('medium');
    expect(result.reason).toContain('review');
  });

  it('should classify high nudity as QUARANTINE', () => {
    const result = classifyModerationResult({
      maxNudityScore: 0.85,
      maxViolenceScore: 0.1
    });

    expect(result.action).toBe('QUARANTINE');
    expect(result.severity).toBe('high');
    expect(result.reason).toContain('nudity');
  });

  it('should classify high violence as QUARANTINE', () => {
    const result = classifyModerationResult({
      maxNudityScore: 0.1,
      maxViolenceScore: 0.82
    });

    expect(result.action).toBe('QUARANTINE');
    expect(result.severity).toBe('high');
    expect(result.reason).toContain('violence');
  });

  it('should use configurable thresholds from env', () => {
    const env = {
      NSFW_THRESHOLD_HIGH: '0.9',
      NSFW_THRESHOLD_MEDIUM: '0.7',
      VIOLENCE_THRESHOLD_HIGH: '0.9',
      VIOLENCE_THRESHOLD_MEDIUM: '0.7'
    };

    // Score that would normally be QUARANTINE
    const result = classifyModerationResult({
      maxNudityScore: 0.85,
      maxViolenceScore: 0.1
    }, env);

    // With higher threshold, should only be REVIEW
    expect(result.action).toBe('REVIEW');
  });

  it('should use default thresholds when env not provided', () => {
    const result = classifyModerationResult({
      maxNudityScore: 0.85,
      maxViolenceScore: 0.1
    });

    expect(result.action).toBe('QUARANTINE');
  });

  it('should include all scores in result', () => {
    const result = classifyModerationResult({
      maxNudityScore: 0.65,
      maxViolenceScore: 0.45,
      maxAiGeneratedScore: 0.2
    });

    expect(result.scores).toEqual({
      nudity: 0.65,
      violence: 0.45,
      ai_generated: 0.2
    });
  });

  it('should identify primary concern', () => {
    const nudityResult = classifyModerationResult({
      maxNudityScore: 0.85,
      maxViolenceScore: 0.1
    });

    expect(nudityResult.primaryConcern).toBe('nudity');

    const violenceResult = classifyModerationResult({
      maxNudityScore: 0.1,
      maxViolenceScore: 0.85
    });

    expect(violenceResult.primaryConcern).toBe('violence');
  });

  it('should handle flagged frames', () => {
    const flaggedFrames = [
      { position: 3, nudityScore: 0.95, reason: 'nudity' }
    ];

    const result = classifyModerationResult({
      maxNudityScore: 0.95,
      maxViolenceScore: 0.1,
      maxAiGeneratedScore: 0.1,
      flaggedFrames
    });

    expect(result.flaggedFrames).toEqual(flaggedFrames);
  });

  it('should classify high AI-generated score as QUARANTINE', () => {
    const result = classifyModerationResult({
      maxNudityScore: 0.1,
      maxViolenceScore: 0.1,
      maxAiGeneratedScore: 0.85
    });

    expect(result.action).toBe('QUARANTINE');
    expect(result.severity).toBe('high');
    expect(result.primaryConcern).toBe('ai_generated');
    expect(result.reason).toContain('ai-generated');
  });

  it('should classify medium AI-generated score as REVIEW', () => {
    const result = classifyModerationResult({
      maxNudityScore: 0.1,
      maxViolenceScore: 0.1,
      maxAiGeneratedScore: 0.65
    });

    expect(result.action).toBe('REVIEW');
    expect(result.severity).toBe('medium');
    expect(result.primaryConcern).toBe('ai_generated');
  });
});
