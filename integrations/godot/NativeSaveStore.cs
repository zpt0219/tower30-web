using System.IO;
namespace Tower30;
// Separate native host storage. The payload is the TS journal, never a C# recreation of gameplay.
public sealed class NativeSaveStore(string path)
{
    public string Path { get; }=System.IO.Path.GetFullPath(path);
    public void Write(string json,bool manual=false)
    {
        var target=Path+(manual?".manual":"");Directory.CreateDirectory(System.IO.Path.GetDirectoryName(target)!);
        File.WriteAllText(target+".tmp",json);
        if(File.Exists(target))File.Copy(target,target+".bak",true);
        File.Move(target+".tmp",target,true);
    }
    public void PreserveRejected()
    {
        if(File.Exists(Path))File.Copy(Path,Path+".rejected-"+System.DateTime.UtcNow.ToString("yyyyMMddHHmmssfff")+"-"+System.Guid.NewGuid().ToString("N"));
    }
    public string? Read(bool manual=false)
    {
        var target=Path+(manual?".manual":"");
        return File.Exists(target)?File.ReadAllText(target):null;
    }
}
