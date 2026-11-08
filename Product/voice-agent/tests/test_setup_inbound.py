import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

from dotenv import dotenv_values
from livekit import api
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from setup_inbound import SetupError, configure, dispatch_request, inbound_request


class InboundConfigurationTests(unittest.IsolatedAsyncioTestCase):
    def client(self):
        trunks, rules = [], []
        async def make_trunk(request):
            trunk = api.SIPInboundTrunkInfo()
            trunk.CopyFrom(request.trunk)
            trunk.sip_trunk_id = 'ST_fixture'
            trunks.append(trunk)
            return trunk
        async def make_rule(request):
            rule = api.SIPDispatchRuleInfo()
            rule.CopyFrom(request.dispatch_rule)
            rule.sip_dispatch_rule_id = 'SDR_fixture'
            rules.append(rule)
            return rule
        async def update_trunk(trunk_id, **fields):
            trunk = next(trunk for trunk in trunks if trunk.sip_trunk_id == trunk_id)
            trunk.allowed_numbers[:] = fields['allowed_numbers']
            return trunk
        async def replace_trunk(trunk_id, replacement):
            trunk = next(trunk for trunk in trunks if trunk.sip_trunk_id == trunk_id)
            trunk.CopyFrom(replacement)
            return trunk
        sip = SimpleNamespace(
            list_inbound_trunk=AsyncMock(side_effect=lambda _: SimpleNamespace(items=trunks)),
            list_dispatch_rule=AsyncMock(side_effect=lambda _: SimpleNamespace(items=rules)),
            create_inbound_trunk=AsyncMock(side_effect=make_trunk),
            create_dispatch_rule=AsyncMock(side_effect=make_rule),
            update_inbound_trunk_fields=AsyncMock(side_effect=update_trunk),
            update_inbound_trunk=AsyncMock(side_effect=replace_trunk),
        )
        return SimpleNamespace(sip=sip), trunks, rules

    async def test_inspection_has_no_mutation_or_credential_file(self):
        client, _, _ = self.client()
        with tempfile.TemporaryDirectory() as directory:
            private = Path(directory) / '.env.sip.local'
            result = await configure(client, '+12025550103', private_file=private)
            self.assertFalse(result['applied'])
            self.assertFalse(private.exists())
        client.sip.create_inbound_trunk.assert_not_awaited()
        client.sip.create_dispatch_rule.assert_not_awaited()
        client.sip.update_inbound_trunk_fields.assert_not_awaited()

    async def test_apply_creates_once_with_private_credentials_and_scoped_dispatch(self):
        client, trunks, rules = self.client()
        with tempfile.TemporaryDirectory() as directory:
            private = Path(directory) / '.env.sip.local'
            first = await configure(client, '+12025550103', apply=True, private_file=private)
            second = await configure(client, '+12025550103', apply=True, private_file=private)
            self.assertTrue(first['createdInboundTrunk'])
            self.assertFalse(second['createdInboundTrunk'])
            self.assertFalse(second['createdDispatchRule'])
            saved = dotenv_values(private)
            self.assertEqual(private.stat().st_mode & 0o777, 0o600)
            self.assertEqual(trunks[0].auth_username, saved['PHAROS_LIVEKIT_SIP_USERNAME'])
            self.assertEqual(trunks[0].auth_password, saved['PHAROS_LIVEKIT_SIP_PASSWORD'])
            self.assertNotIn(saved['PHAROS_LIVEKIT_SIP_PASSWORD'], str(first))
        self.assertEqual(list(trunks[0].numbers), ['+12025550103'])
        self.assertEqual(trunks[0].max_call_duration.seconds, 180)
        self.assertEqual(trunks[0].ringing_timeout.seconds, 60)
        self.assertEqual(trunks[0].media_encryption, api.SIP_MEDIA_ENCRYPT_ALLOW)
        self.assertEqual(list(rules[0].trunk_ids), ['ST_fixture'])
        self.assertEqual([entry.agent_name for entry in rules[0].room_config.agents], ['pharos-intake'])
        self.assertFalse(rules[0].rule.dispatch_rule_individual.no_randomness)
        self.assertEqual(client.sip.create_inbound_trunk.await_count, 1)
        self.assertEqual(client.sip.create_dispatch_rule.await_count, 1)

    async def test_sync_updates_only_owned_trunk_allowlist_once_and_keeps_credentials(self):
        client, trunks, _ = self.client()
        with tempfile.TemporaryDirectory() as directory:
            private = Path(directory) / '.env.sip.local'
            await configure(client, '+12025550103', apply=True, private_file=private)
            credentials_before = private.read_bytes()
            original = api.SIPInboundTrunkInfo()
            original.CopyFrom(trunks[0])
            first = await configure(client, '+12025550103', apply=True, private_file=private,
                                    allowed_callers=['+12025550104', '+12025550104'], sync_test_callers=True)
            second = await configure(client, '+12025550103', apply=True, private_file=private,
                                     allowed_callers=['+12025550104'], sync_test_callers=True)
            self.assertTrue(first['updatedCallerAllowlist'])
            self.assertFalse(second['updatedCallerAllowlist'])
            client.sip.update_inbound_trunk_fields.assert_awaited_once_with(
                'ST_fixture', allowed_numbers=['+12025550104'])
            self.assertEqual(private.read_bytes(), credentials_before)
            original.allowed_numbers[:] = ['+12025550104']
            self.assertEqual(trunks[0], original)
            self.assertNotIn('+12025550104', str(first))
        self.assertEqual(client.sip.create_inbound_trunk.await_count, 1)
        self.assertEqual(client.sip.create_dispatch_rule.await_count, 1)

    async def test_changed_allowlist_requires_explicit_sync_and_cannot_be_cleared(self):
        client, trunks, _ = self.client()
        with tempfile.TemporaryDirectory() as directory:
            private = Path(directory) / '.env.sip.local'
            await configure(client, '+12025550103', apply=True, private_file=private,
                            allowed_callers=['+12025550104'])
            credentials_before = private.read_bytes()
            with self.assertRaises(SetupError):
                await configure(client, '+12025550103', apply=True, private_file=private,
                                allowed_callers=['+12025550105'])
            with self.assertRaises(SetupError):
                await configure(client, '+12025550103', apply=True, private_file=private,
                                allowed_callers=[], sync_test_callers=True)
            self.assertEqual(private.read_bytes(), credentials_before)
            self.assertEqual(list(trunks[0].allowed_numbers), ['+12025550104'])
        client.sip.update_inbound_trunk_fields.assert_not_awaited()

    async def test_sync_refuses_inspection_and_unowned_trunk(self):
        client, trunks, _ = self.client()
        trunks.append(api.SIPInboundTrunkInfo(sip_trunk_id='ST_other', numbers=['+12025550103'], auth_username='other-owner'))
        with tempfile.TemporaryDirectory() as directory:
            private = Path(directory) / '.env.sip.local'
            for apply in (False, True):
                with self.assertRaises(SetupError):
                    await configure(client, '+12025550103', apply=apply, private_file=private,
                                    allowed_callers=['+12025550104'], sync_test_callers=True)
            self.assertFalse(private.exists())
        client.sip.update_inbound_trunk_fields.assert_not_awaited()

    async def test_existing_unowned_trunk_is_preserved(self):
        client, trunks, _ = self.client()
        trunks.append(api.SIPInboundTrunkInfo(sip_trunk_id='ST_other', numbers=['+12025550103'], auth_username='other-owner'))
        with tempfile.TemporaryDirectory() as directory:
            private = Path(directory) / '.env.sip.local'
            with self.assertRaises(SetupError):
                await configure(client, '+12025550103', apply=True, private_file=private)
            self.assertFalse(private.exists())
        client.sip.create_inbound_trunk.assert_not_awaited()
        client.sip.create_dispatch_rule.assert_not_awaited()

    async def test_hosted_preparation_changes_only_ringing_restores_same_redacted_password_and_is_idempotent(self):
        client, trunks, rules = self.client()
        with tempfile.TemporaryDirectory() as directory:
            private = Path(directory) / '.env.sip.local'
            await configure(client, '+12025550103', apply=True, private_file=private,
                            allowed_callers=['+12025550104'])
            private_before = private.read_bytes()
            saved = dotenv_values(private)
            trunk = trunks[0]
            trunk.ringing_timeout.seconds = 15
            trunk.auth_password = ''  # Real list responses may redact this.
            trunk.allowed_addresses.extend(['192.0.2.0/24'])
            trunk.metadata = '{"purpose":"fixture-preserve"}'
            trunk.headers_to_attributes['X-Fixture'] = 'fixture.value'
            trunk.krisp_enabled = True
            original = api.SIPInboundTrunkInfo()
            original.CopyFrom(trunk)
            expected = api.SIPInboundTrunkInfo()
            expected.CopyFrom(original)
            expected.auth_password = saved['PHAROS_LIVEKIT_SIP_PASSWORD']
            expected.ringing_timeout.seconds = 60
            first = await configure(client, '+12025550103', apply=True, private_file=private,
                                    allowed_callers=['+12025550199'], prepare_hosted=True)
            # The live allowlist wins; a differing local env must not alter it.
            second = await configure(client, '+12025550103', apply=True, private_file=private, prepare_hosted=True)
            self.assertTrue(first['updatedRingingTimeout'])
            self.assertFalse(second['updatedRingingTimeout'])
            self.assertEqual(trunk, expected)
            self.assertEqual(private.read_bytes(), private_before)
            self.assertEqual(first['ringingTimeoutSeconds'], 60)
            self.assertEqual(first['maxCallDurationSeconds'], 180)
            self.assertNotIn(saved['PHAROS_LIVEKIT_SIP_PASSWORD'], str(first))
        client.sip.update_inbound_trunk.assert_awaited_once()
        client.sip.update_inbound_trunk_fields.assert_not_awaited()
        self.assertEqual(client.sip.create_inbound_trunk.await_count, 1)
        self.assertEqual(client.sip.create_dispatch_rule.await_count, 1)
        self.assertEqual(len(rules), 1)

    async def test_hosted_preparation_refuses_missing_ownership_and_preserves_every_resource(self):
        for changed_field in ('saved_id', 'number_scope', 'username', 'password', 'duration'):
            with self.subTest(changed_field=changed_field):
                client, trunks, _ = self.client()
                with tempfile.TemporaryDirectory() as directory:
                    private = Path(directory) / '.env.sip.local'
                    await configure(client, '+12025550103', apply=True, private_file=private)
                    trunk = trunks[0]
                    trunk.ringing_timeout.seconds = 15
                    if changed_field == 'saved_id':
                        trunk.sip_trunk_id = 'ST_unowned'
                    elif changed_field == 'number_scope':
                        trunk.numbers.append('+12025550105')
                    elif changed_field == 'username':
                        trunk.auth_username = 'another-owner'
                    elif changed_field == 'password':
                        trunk.auth_password = 'an-unexpected-different-password'
                    elif changed_field == 'duration':
                        trunk.max_call_duration.seconds = 300
                    before = trunk.SerializeToString()
                    private_before = private.read_bytes()
                    with self.assertRaises(SetupError):
                        await configure(client, '+12025550103', apply=True, private_file=private, prepare_hosted=True)
                    self.assertEqual(trunk.SerializeToString(), before)
                    self.assertEqual(private.read_bytes(), private_before)
                client.sip.update_inbound_trunk.assert_not_awaited()
                client.sip.update_inbound_trunk_fields.assert_not_awaited()

    async def test_hosted_preparation_never_creates_resources_or_combines_allowlist_mutation(self):
        client, _, _ = self.client()
        with tempfile.TemporaryDirectory() as directory:
            private = Path(directory) / '.env.sip.local'
            for options in ({'apply': False}, {'apply': True},
                            {'apply': True, 'sync_test_callers': True, 'allowed_callers': ['+12025550104']}):
                with self.assertRaises(SetupError):
                    await configure(client, '+12025550103', private_file=private, prepare_hosted=True, **options)
                self.assertFalse(private.exists())
        client.sip.create_inbound_trunk.assert_not_awaited()
        client.sip.create_dispatch_rule.assert_not_awaited()
        client.sip.update_inbound_trunk.assert_not_awaited()


if __name__ == '__main__':
    unittest.main()
