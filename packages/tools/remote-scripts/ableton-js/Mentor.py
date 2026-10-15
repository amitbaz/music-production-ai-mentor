# The music production mentor's own file in the ableton-js Remote Script. It gives the functions
# the script cannot reach, under the namespace "mentor", and is the only file of ours in this folder.
# Live only runs it, so it can only be tried by hand: see ../checklist.md.
import Live

from .Namespaces.Interface import Interface
from .Namespaces.Track import Track

# The version of this file, which the client checks on connect. Raise it with every change here,
# and the client's MENTOR_VERSION with it, so a copy installed earlier is told to pair again.
VERSION = "3"


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

    def modify_notes(self, ns, clip_id, notes):
        """Changes notes of a MIDI clip, each named by note_id with the fields to set, such as
        start_time, duration, pitch, velocity and probability. Unlike the script's own
        apply_note_modifications, which looks only at the notes from beat 0, it reads them from far
        before the clip's start, so a note before the start can be changed too."""
        clip = Interface.get_obj(clip_id)
        existing = clip.get_notes_extended(0, 128, -1000000.0, 99999999999999.0)
        by_id = {note.note_id: note for note in existing}
        for change in notes:
            note = by_id.get(change["note_id"])
            if note is None:
                continue
            for key, value in change.items():
                if key != "note_id":
                    setattr(note, key, value)
        clip.apply_note_modifications(existing)

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

    def delete(self, ns, object_id):
        """Deletes a track, device or clip, found where it is at the moment of deleting through its
        parent in Live. Gives its name."""
        obj = Interface.get_obj(object_id)
        try:
            name = obj.name
            parent = obj.canonical_parent
        except Exception:
            # Deleted in Live since its id was given, as with the track or rack that held it.
            raise Exception(f"Unknown object id: {object_id}")
        song = self.ableton.song()
        if isinstance(obj, Live.Track.Track):
            if obj in song.tracks:
                song.delete_track(list(song.tracks).index(obj))
            elif obj in song.return_tracks:
                song.delete_return_track(list(song.return_tracks).index(obj))
            else:
                raise Exception("Main cannot be deleted")
        elif isinstance(obj, Live.Device.Device):
            # A track or a rack chain.
            parent.delete_device(list(parent.devices).index(obj))
        elif isinstance(obj, Live.Clip.Clip):
            # A Session clip is held by its slot, an arrangement clip by its track. A clip in a take
            # lane is held by the lane, which offers no way to delete it.
            if isinstance(parent, Live.ClipSlot.ClipSlot):
                parent.delete_clip()
            elif isinstance(parent, Live.Track.Track):
                parent.delete_clip(obj)
            else:
                raise Exception(f"{name} is in a take lane, and Live gives a script no way to delete a clip there")
        else:
            raise Exception(f"{name} is not a track, device or clip")
        Interface.obj_ids.pop(object_id, None)
        return name
