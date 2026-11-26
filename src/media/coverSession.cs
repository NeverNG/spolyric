using System;
using System.IO;
using Windows.Media.Control;

// Reads the album art of the Spotify session through the Windows media session (SMTC).
// This is the exact cover Spotify shows; no catalogue matching involved.
public static class Program
{
    public static int Main(string[] args)
    {
        if (args.Length < 1)
        {
            Console.Error.WriteLine("usage: cover.exe <output>");
            return 2;
        }
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
                    File.WriteAllBytes(args[0], bytes);
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
