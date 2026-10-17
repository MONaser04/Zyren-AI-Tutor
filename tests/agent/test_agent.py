import os
import sys
import asyncio
import json
from pathlib import Path

# Add project root and agent directory to sys.path
PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT / "agent"))
sys.path.insert(0, str(PROJECT_ROOT))
from agent import TutorAgent

import pytest

@pytest.mark.asyncio
async def test_draw_3d_graph():
    class DummyCtx:
        pass
    class DummyRoom:
        class DummyLocalParticipant:
            async def publish_data(self, payload, *args, **kwargs):
                print(f'Payload: {json.dumps(json.loads(payload.decode("utf-8")), indent=2)}')
        local_participant = DummyLocalParticipant()
        
    room = DummyRoom()
    agent = TutorAgent(room)
    agent.ctx = DummyCtx()
    agent.ctx.room = room
    await agent.draw_3d_graph('Spherical Shell with x>0 Cutaway', plot_type='bounded_surfaces', equation_z='9 <= x^2 + y^2 + z^2 <= 16', cross_section='x > 0')

if __name__ == "__main__":
    asyncio.run(test_draw_3d_graph())

