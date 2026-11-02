using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Text.Json;

namespace Tower30;

// No gameplay here. One runtime/context per session, same thread as the Godot owner.
public sealed class QuickJsSession : IDisposable
{
    private const string Library = "tower_quickjs";
    private static string? libraryPath;
    static QuickJsSession() => NativeLibrary.SetDllImportResolver(typeof(QuickJsSession).Assembly,
        (name, _, _) => name == Library ? NativeLibrary.Load(libraryPath ?? throw new InvalidOperationException("Native path missing")) : IntPtr.Zero);
    [DllImport(Library, CallingConvention=CallingConvention.Cdecl)] private static extern IntPtr tower_create([MarshalAs(UnmanagedType.LPUTF8Str)] string source);
    [DllImport(Library, CallingConvention=CallingConvention.Cdecl)] private static extern IntPtr tower_call(IntPtr host,[MarshalAs(UnmanagedType.LPUTF8Str)] string request);
    [DllImport(Library, CallingConvention=CallingConvention.Cdecl)] private static extern IntPtr tower_error(IntPtr host);
    [DllImport(Library, CallingConvention=CallingConvention.Cdecl)] private static extern void tower_free_string(IntPtr value);
    [DllImport(Library, CallingConvention=CallingConvention.Cdecl)] private static extern void tower_destroy(IntPtr host);
    private IntPtr handle;
    public QuickJsSession(string generatedDirectory)
    {
        var path=Path.GetFullPath(Path.Combine(generatedDirectory,"libtower_quickjs.so"));
        if(libraryPath!=null && libraryPath!=path)throw new InvalidOperationException("One native library path per process");
        libraryPath=path;
        handle=tower_create(File.ReadAllText(Path.Combine(generatedDirectory,"tower30-core.js")));
        var error=Marshal.PtrToStringUTF8(tower_error(handle));
        if(error!=null){Dispose();throw new InvalidOperationException(error);}
    }
    public string CallRaw(string json)
    {
        ObjectDisposedException.ThrowIf(handle==IntPtr.Zero,this);
        var result=tower_call(handle,json);
        if(result==IntPtr.Zero)throw new InvalidOperationException(Marshal.PtrToStringUTF8(tower_error(handle))??"Native allocation failed");
        try{return Marshal.PtrToStringUTF8(result)??throw new InvalidOperationException("Empty bridge response");}
        finally{tower_free_string(result);}
    }
    public JsonElement Invoke(object request)
    {
        using var doc=JsonDocument.Parse(CallRaw(JsonSerializer.Serialize(request)));
        var root=doc.RootElement;
        if(root.GetProperty("version").GetInt32()!=1)throw new InvalidOperationException("Bridge protocol mismatch");
        if(!root.GetProperty("ok").GetBoolean())throw new InvalidOperationException(root.GetProperty("error").GetString());
        return root.GetProperty("value").Clone();
    }
    public void Dispose(){if(handle==IntPtr.Zero)return;tower_destroy(handle);handle=IntPtr.Zero;GC.SuppressFinalize(this);}
}
