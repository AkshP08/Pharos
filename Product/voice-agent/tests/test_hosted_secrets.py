import tempfile
import unittest
from pathlib import Path
import sys

from dotenv import dotenv_values

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from pharos_runtime import ConfigurationError
from prepare_hosted_secrets import runtime_secrets, write_private


class HostedSecretsTests(unittest.TestCase):
    def source(self):
        return {
            'PHAROS_API_URL': 'https://pharos.example',
            'PHAROS_INGEST_TOKEN': 'fictional-private-token',
            'PHAROS_TEST_CALLER_NUMBERS': '+12025550101',
            'LIVEKIT_API_KEY': 'never-export-this',
            'LIVEKIT_API_SECRET': 'never-export-this-either',
            'PHOTON_API_KEY': 'never-export-photon',
            'PHAROS_LIVEKIT_SIP_PASSWORD': 'never-export-digest',
            'PHAROS_GUARD_RESIDENT_NUMBER': '+12025550102',
            'PHAROS_ENABLE_GUARD_RELAY': 'true',
            'PHAROS_ALLOW_BROWSER_TESTS': 'true',
        }

    def test_intake_exports_only_required_settings_and_forces_phone_test_gate(self):
        values = runtime_secrets(self.source(), 'intake')
        self.assertEqual(values['PHAROS_AGENT_NAME'], 'pharos-intake')
        self.assertEqual(values['PHAROS_CALL_MODE'], 'intake')
        self.assertEqual(values['PHAROS_ENABLE_GUARD_RELAY'], 'false')
        self.assertEqual(values['PHAROS_ALLOW_BROWSER_TESTS'], 'false')
        self.assertFalse(any(key.startswith('LIVEKIT_') or key.startswith('PHOTON_') for key in values))
        self.assertNotIn('PHAROS_GUARD_RESIDENT_NUMBER', values)
        self.assertNotIn('PHAROS_LIVEKIT_SIP_PASSWORD', values)

    def test_guard_preparation_never_enables_missing_recipient_consent(self):
        with self.assertRaises(ConfigurationError):
            runtime_secrets(self.source(), 'guard')
        source = {**self.source(), 'PHAROS_GUARD_RESIDENT_CONSENTED': 'true',
                  'LIVEKIT_OUTBOUND_TRUNK_ID': 'ST_fixture'}
        values = runtime_secrets(source, 'guard')
        self.assertEqual(values['PHAROS_AGENT_NAME'], 'pharos-guard')
        self.assertEqual(values['LIVEKIT_OUTBOUND_TRUNK_ID'], 'ST_fixture')
        self.assertNotIn('LIVEKIT_API_SECRET', values)

    def test_private_file_roundtrips_quotes_and_has_restrictive_permissions(self):
        values = runtime_secrets(self.source(), 'intake')
        values['PHAROS_INGEST_TOKEN'] = 'fictional$token with "quotes"'
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / '.env.hosted.local'
            write_private(path, values)
            self.assertEqual(dotenv_values(path, interpolate=False), values)
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)


if __name__ == '__main__':
    unittest.main()
