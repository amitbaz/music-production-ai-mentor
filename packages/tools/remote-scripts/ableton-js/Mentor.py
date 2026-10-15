# The music production mentor's own file in the ableton-js Remote Script. It gives the functions
# the script cannot reach, under the namespace "mentor", and is the only file of ours in this folder.
# Live only runs it, so it can only be tried by hand: see ../checklist.md.
import Live

from .Namespaces.Interface import Interface
from .Namespaces.Track import Track

# The version of this file, which the client checks on connect. Raise it with every change here,
# and the client's MENTOR_VERSION with it, so a copy installed earlier is told to pair again.
VERSION = "1"


class Mentor(Interface):
    def get_ns(self, nsid):
        # No object of its own: each function is given the ids of the Live objects it works on.
        return None

    def get_version(self, ns):
        return VERSION

    def move_device(self, ns, device_id, target_id, position):
        """Moves a device into a track or rack chain at a position counted from 0, which can be
        another place in its own chain. Gives the position Live used."""
        device = Interface.get_obj(device_id)
        target = Interface.get_obj(target_id)
        return self.ableton.song().move_device(device, target, int(position))

    def add_notes(self, ns, clip_id, notes):
        """Adds notes to a MIDI clip, each with pitch, start_time, duration and velocity, and
        optionally mute, probability (0 to 1), velocity_deviation and release_velocity.
        Gives the ids Live made for them."""
        clip = Interface.get_obj(clip_id)
        specifications = tuple(Live.Clip.MidiNoteSpecification(**note) for note in notes)
        return list(clip.add_new_notes(specifications))

    def set_compressor_sidechain(self, ns, device_id, routing_type, routing_channel=None):
        """Sets the sidechain source of a Compressor by the names Live shows, such as the
        track's name for the type and "Post FX" for the channel. Gives what is set."""
        device = Interface.get_obj(device_id)
        device.input_routing_type = Track._find_routing_type(
            device.available_input_routing_types, routing_type
        )
        # The channels on offer depend on the type, so they are read after it is set.
        if routing_channel is not None:
            device.input_routing_channel = Track._find_routing_channel(
                device.available_input_routing_channels, routing_channel
            )
        return {
            "type": device.input_routing_type.display_name,
            "channel": device.input_routing_channel.display_name,
        }

    def replace_simpler_sample(self, ns, device_id, file_path):
        """Loads a sample file into a Simpler, from Live 12.4. Gives the path Live reports."""
        device = Interface.get_obj(device_id)
        device.replace_sample(file_path)
        return device.sample.file_path
