using System;
using System.IO;
using Windows.Media.Control;

// Writes the Spotify session's album art (the exact thumbnail Spotify shows) to stdout as raw bytes.
// SMTC's thumbnail stream is not reachable from PowerShell 5.1's WinRT projection, so the daemon runs
// this small helper and reads its stdout. Source: coverSession.cs; compiled with csc.
public static class Program
{
    public static int Main()
    {
        try
        {
            var manager = GlobalSystemMediaTransportControlsSessionManager.RequestAsync().AsTask().GetAwaiter().GetResult();
            foreach (var session in manager.GetSessions())
            {
                var app = (session.SourceAppUserModelId ?? string.Empty).ToLowerInvariant();
                if (!app.Contains("spotify")) continue;
                var properties = session.TryGetMediaPropertiesAsync().AsTask().GetAwaiter().GetResult();
                var thumbnail = properties.Thumbnail;
                if (thumbnail == null) continue;
                using (var stream = thumbnail.OpenReadAsync().AsTask().GetAwaiter().GetResult())
                {
                    var bytes = new byte[stream.Size];
                    using (var reader = new Windows.Storage.Streams.DataReader(stream.GetInputStreamAt(0)))
                    {
                        reader.LoadAsync((uint)stream.Size).AsTask().GetAwaiter().GetResult();
                        reader.ReadBytes(bytes);
                    }
                    using (var stdout = Console.OpenStandardOutput())
                    {
                        stdout.Write(bytes, 0, bytes.Length);
                        stdout.Flush();
                    }
                }
                return 0;
            }
            Console.Error.WriteLine("no Spotify thumbnail");
            return 1;
        }
        catch (Exception error)
        {
            Console.Error.WriteLine(error.Message);
            return 1;
        }
    }
}
