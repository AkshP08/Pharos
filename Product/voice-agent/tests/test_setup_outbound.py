import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock

from dotenv import dotenv_values, set_key
from livekit import api

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from setup_outbound import SetupError, TRUNK_NAME, configure


class OutboundSetupTests(unittest.IsolatedAsyncioTestCase):
    def client(self, lose_response=False):
        trunks = []
        async def create(request):
            trunk = api.SIPOutboundTrunkInfo()
            trunk.CopyFrom(request.trunk)
            trunk.sip_trunk_id = 'ST_outbound_fixture'
            trunks.append(trunk)
            if lose_response:
                raise TimeoutError('private provider response')
            return trunk
        sip = SimpleNamespace(
            list_outbound_trunk=AsyncMock(side_effect=lambda _: SimpleNamespace(items=trunks)),
            create_outbound_trunk=AsyncMock(side_effect=create),
            create_sip_participant=AsyncMock(side_effect=AssertionError('setup must never dial')),
        )
        return SimpleNamespace(sip=sip), trunks

    def credentials(self, directory):
        path = Path(directory) / '.env.outbound.local'
        path.write_text("# private fixture\nPHAROS_PHOTON_SIP_USERNAME=photon_fixture\n"
                        "PHAROS_PHOTON_SIP_PASSWORD='fixture-long-password'\n"
                        "PHAROS_PHOTON_SIP_HOST=sip.photon.codes\nPHAROS_PHOTON_SIP_PORT=5061\n"
                        "PHAROS_PHOTON_SIP_REALM=realm-is-not-a-server.invalid\n")
        return path

    async def test_inspect_never_creates_files_mutates_or_dials(self):
        client, _ = self.client()
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / '.env.outbound.local'
            result = await configure(client, '+12025550101', private_file=path)
            self.assertFalse(result['applied'])
            self.assertFalse(result['credentialFileConfigured'])
            self.assertFalse(path.exists())
        client.sip.create_outbound_trunk.assert_not_awaited()
        client.sip.create_sip_participant.assert_not_awaited()

    async def test_apply_is_idempotent_private_tls_and_never_uses_auth_realm_as_server(self):
        client, trunks = self.client()
        with tempfile.TemporaryDirectory() as directory:
            path = self.credentials(directory)
            first = await configure(client, '+12025550101', apply=True, private_file=path)
            second = await configure(client, '+12025550101', apply=True, private_file=path)
            self.assertTrue(first['createdOutboundTrunk'])
            self.assertFalse(second['createdOutboundTrunk'])
            self.assertFalse(first['callPlaced'])
            saved = dotenv_values(path)
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            self.assertEqual(saved['LIVEKIT_OUTBOUND_TRUNK_ID'], 'ST_outbound_fixture')
            for secret in ('fixture-long-password', 'photon_fixture', '+12025550101'):
                self.assertNotIn(secret, json.dumps(first))
            self.assertEqual(trunks[0].address, 'sip.photon.codes:5061')
            self.assertEqual(trunks[0].transport, api.SIP_TRANSPORT_TLS)
            self.assertEqual(trunks[0].media_encryption, api.SIP_MEDIA_ENCRYPT_ALLOW)
            self.assertEqual(list(trunks[0].numbers), ['+12025550101'])
            self.assertEqual(trunks[0].auth_password, saved['PHAROS_PHOTON_SIP_PASSWORD'])
            self.assertEqual(trunks[0].destination_country, '')
        client.sip.create_outbound_trunk.assert_awaited_once()
        client.sip.create_sip_participant.assert_not_awaited()

    async def test_lost_creation_response_reconciles_without_duplicate_or_rotation(self):
        client, trunks = self.client(lose_response=True)
        with tempfile.TemporaryDirectory() as directory:
            path = self.credentials(directory)
            with self.assertRaises(TimeoutError):
                await configure(client, '+12025550101', apply=True, private_file=path)
            saved = dotenv_values(path)
            self.assertNotIn('LIVEKIT_OUTBOUND_TRUNK_ID', saved)
            owner = json.loads(trunks[0].metadata)['owner']
            self.assertEqual(saved['PHAROS_LIVEKIT_OUTBOUND_OWNER_ID'], owner)
            result = await configure(client, '+12025550101', apply=True, private_file=path)
            self.assertFalse(result['createdOutboundTrunk'])
            self.assertEqual(dotenv_values(path)['LIVEKIT_OUTBOUND_TRUNK_ID'], 'ST_outbound_fixture')
        client.sip.create_outbound_trunk.assert_awaited_once()

    async def test_unowned_or_ambiguous_trunks_are_preserved(self):
        client, trunks = self.client()
        trunks.append(api.SIPOutboundTrunkInfo(sip_trunk_id='ST_foreign', name=TRUNK_NAME, numbers=['+12025550101']))
        with tempfile.TemporaryDirectory() as directory:
            path = self.credentials(directory)
            before = path.read_bytes()
            with self.assertRaises(SetupError):
                await configure(client, '+12025550101', apply=True, private_file=path)
            self.assertEqual(path.read_bytes(), before)
            trunks.append(api.SIPOutboundTrunkInfo(sip_trunk_id='ST_another', numbers=['+12025550101']))
            with self.assertRaises(SetupError):
                await configure(client, '+12025550101', apply=True, private_file=path)
        client.sip.create_outbound_trunk.assert_not_awaited()

    async def test_credential_changes_and_remote_configuration_changes_do_not_overwrite(self):
        client, trunks = self.client()
        with tempfile.TemporaryDirectory() as directory:
            path = self.credentials(directory)
            await configure(client, '+12025550101', apply=True, private_file=path)
            set_key(str(path), 'PHAROS_PHOTON_SIP_PASSWORD', 'new-long-password')
            with self.assertRaises(SetupError):
                await configure(client, '+12025550101', apply=True, private_file=path)
            self.assertEqual(trunks[0].auth_password, 'fixture-long-password')
            set_key(str(path), 'PHAROS_PHOTON_SIP_PASSWORD', 'fixture-long-password')
            trunks[0].transport = api.SIP_TRANSPORT_UDP
            with self.assertRaises(SetupError):
                await configure(client, '+12025550101', apply=True, private_file=path)
            self.assertEqual(trunks[0].transport, api.SIP_TRANSPORT_UDP)
        client.sip.create_outbound_trunk.assert_awaited_once()

    async def test_missing_credentials_non_photon_endpoint_md5_and_symlink_fail_without_mutation(self):
        for field, value in [('PHAROS_PHOTON_SIP_PASSWORD', ''),
                             ('PHAROS_PHOTON_SIP_HOST', 'sip.photon.codes.attacker.invalid'),
                             ('PHAROS_PHOTON_SIP_PORT', '5061/path'),
                             ('PHAROS_PHOTON_SIP_DIGEST', 'MD5')]:
            client, _ = self.client()
            with tempfile.TemporaryDirectory() as directory:
                path = self.credentials(directory)
                set_key(str(path), field, value)
                with self.assertRaises(SetupError):
                    await configure(client, '+12025550101', apply=True, private_file=path)
            client.sip.create_outbound_trunk.assert_not_awaited()
            client.sip.create_sip_participant.assert_not_awaited()
        client, _ = self.client()
        with tempfile.TemporaryDirectory() as directory:
            target = self.credentials(directory)
            link = Path(directory) / 'link'
            link.symlink_to(target)
            with self.assertRaises(SetupError):
                await configure(client, '+12025550101', apply=True, private_file=link)
        client.sip.list_outbound_trunk.assert_not_awaited()


if __name__ == '__main__':
    unittest.main()
