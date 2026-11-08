"""Independent regressions for consent qualifications; no credentials/providers."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from pharos_runtime import is_consent_withdrawal, parse_consent


class IndependentConsentContracts(unittest.TestCase):
    def test_explicit_audio_limits_override_yes_and_preserve_help_facts(self):
        for qualification in ("no audio please", "I do not want audio recorded", "I don't want any audio recorded",
                              "I don't want to be recorded", "not the audio", "audio off"):
            with self.subTest(qualification=qualification):
                answer = parse_consent(f"Yes, {qualification}. We need shelter near Northbank.")
                self.assertIs(answer.decision, True)
                self.assertFalse(answer.audio_consent)
                self.assertIn("We need shelter near Northbank", answer.remainder)

    def test_transcript_only_agreement_preserves_combined_facts(self):
        for prefix in ("I agree to transcript only", "Yes, just a transcript", "Transcript only", "Yes but transcript only"):
            with self.subTest(prefix=prefix):
                answer = parse_consent(f"{prefix}. Three people need shelter.")
                self.assertIs(answer.decision, True)
                self.assertFalse(answer.audio_consent)
                self.assertIn("Three people need shelter", answer.remainder)

    def test_no_audio_alone_does_not_mean_declining_help_or_allow_transcript(self):
        answer = parse_consent("No audio please. We need shelter.")
        self.assertIsNone(answer.decision)
        self.assertFalse(answer.audio_consent)
        self.assertIs(parse_consent("No, transcript only.").decision, False)

    def test_direct_recording_stop_keeps_safe_refusal_unless_text_explicitly_permitted(self):
        self.assertIs(parse_consent("Yes, don't record me.").decision, False)
        answer = parse_consent("Yes, don't record me, transcript only. We need shelter.")
        self.assertIs(answer.decision, True)
        self.assertFalse(answer.audio_consent)
        self.assertIn("We need shelter", answer.remainder)

    def test_polite_caller_stop_requests_are_withdrawal(self):
        for text in ("Please stop the recording.", "Can you stop recording?", "Could you please stop the recording?",
                     "I want you to stop recording.", "We need you to stop sharing.", "I withdraw my consent."):
            with self.subTest(text=text):
                self.assertTrue(is_consent_withdrawal(text))

    def test_audio_restrictions_after_consent_also_close_existing_collection(self):
        for text in ("No audio please.", "Transcript only.", "I don't want audio recorded."):
            with self.subTest(text=text):
                self.assertTrue(is_consent_withdrawal(text))

    def test_quoted_victim_statements_do_not_withdraw_the_callers_consent(self):
        for text in ('The scammer said "I withdraw consent". I still need help.',
                     'He told me "stop recording". We need shelter.',
                     "The caller said 'please stop the recording'. I need help.",
                     "The scammer said, I withdraw consent. I still need help.",
                     'Yes, they said "no audio". We need shelter.'):
            with self.subTest(text=text):
                self.assertFalse(is_consent_withdrawal(text))

    def test_own_request_outside_reported_quote_still_withdraws(self):
        for text in ('He said "stop recording", but I want you to stop the recording.',
                     'They said "I withdraw consent". Please stop recording me.'):
            with self.subTest(text=text):
                self.assertTrue(is_consent_withdrawal(text))

    def test_audio_uncertainty_never_becomes_audio_permission_but_fact_uncertainty_is_kept(self):
        for text in ("Yes, I am not sure about audio.", "Yes, audio recording maybe.", "Yes, maybe recording is okay."):
            with self.subTest(text=text):
                self.assertFalse(parse_consent(text).audio_consent)
        answer = parse_consent("Yes, not sure where I am. No one is injured.")
        self.assertIs(answer.decision, True)
        self.assertTrue(answer.audio_consent)
        self.assertIn("No one is injured", answer.remainder)


if __name__ == "__main__":
    unittest.main()
