// HK_Judge C# 채점 러너 (Cloud Run).
//   POST /run { code, stdin, runTimeoutMs } → { compileError, compileOutput, stdout, stderr, timedOut, exitCode }
//   학생 코드를 임시 프로젝트로 dotnet build 후, 격리된 자식 프로세스로 실행(월클럭 타임아웃·출력 제한).
//   진짜 .NET(리눅스)이라 UTF-8 기본 → 한글 출력 정상. InvariantGlobalization 로 소수점 '.' 고정.
using System.Diagnostics;
using System.Text;

var builder = WebApplication.CreateBuilder(args);
var app = builder.Build();

var port = Environment.GetEnvironmentVariable("PORT") ?? "8080";
app.Urls.Add($"http://0.0.0.0:{port}");
var secret = Environment.GetEnvironmentVariable("JUDGE_SHARED_SECRET") ?? "";

const int MaxOut = 64 * 1024;      // 출력 상한(바이트 기준 대략)
const int MaxCode = 20000;
// 학생 프로젝트 TFM — 기본 net8.0(도커 sdk:8.0 이미지). 다른 SDK로 로컬 검증 시 RUNNER_TFM 로 덮어씀.
var runnerTfm = Environment.GetEnvironmentVariable("RUNNER_TFM") ?? "net8.0";

app.MapGet("/", () => Results.Text("hk-judge runner ok"));

app.MapPost("/run", async (HttpContext ctx) =>
{
    if (!string.IsNullOrEmpty(secret) && ctx.Request.Headers["X-Judge-Secret"].ToString() != secret)
        return Results.StatusCode(401);

    RunReq req;
    try { req = await ctx.Request.ReadFromJsonAsync<RunReq>() ?? new RunReq(); }
    catch { return Results.BadRequest(new { error = "invalid json" }); }

    var code = req.code ?? "";
    if (string.IsNullOrWhiteSpace(code)) return Results.BadRequest(new { error = "empty code" });
    if (code.Length > MaxCode) return Results.BadRequest(new { error = "code too long" });
    var stdin = req.stdin ?? "";
    var runTimeout = Math.Clamp(req.runTimeoutMs ?? 8000, 1000, 20000);

    var work = Path.Combine(Path.GetTempPath(), "run-" + Guid.NewGuid().ToString("N"));
    Directory.CreateDirectory(work);
    try
    {
        await File.WriteAllTextAsync(Path.Combine(work, "Program.cs"), code);
        await File.WriteAllTextAsync(Path.Combine(work, "app.csproj"), CsProjText(runnerTfm));

        // 1) 컴파일
        var build = await Exec("dotnet", $"build app.csproj -c Release -o out --nologo -v quiet /clp:ErrorsOnly", work, null, 40000);
        if (build.timedOut)
            return Results.Json(new RunResp { compileError = true, compileOutput = "컴파일 시간 초과", stdout = "", stderr = "", timedOut = false, exitCode = -1 });
        if (build.exitCode != 0)
        {
            var msg = (build.stdout + "\n" + build.stderr).Trim();
            return Results.Json(new RunResp { compileError = true, compileOutput = Cap(msg), stdout = "", stderr = "", timedOut = false, exitCode = build.exitCode });
        }

        // 2) 실행 (격리된 자식 프로세스, 타임아웃)
        var dll = Path.Combine(work, "out", "app.dll");
        var run = await Exec("dotnet", $"\"{dll}\"", work, stdin, runTimeout);
        return Results.Json(new RunResp
        {
            compileError = false,
            compileOutput = "",
            stdout = Cap(run.stdout),
            stderr = Cap(run.stderr),
            timedOut = run.timedOut,
            exitCode = run.exitCode,
        });
    }
    catch (Exception e)
    {
        return Results.Json(new RunResp { compileError = false, compileOutput = "", stdout = "", stderr = "runner error: " + e.Message, timedOut = false, exitCode = -1 });
    }
    finally
    {
        try { Directory.Delete(work, true); } catch { }
    }
});

app.Run();

static string Cap(string s) => string.IsNullOrEmpty(s) ? "" : (s.Length > MaxOut ? s[..MaxOut] + "\n...(truncated)" : s);

// 프로세스 실행: stdin 주입, stdout/stderr 캡처, 월클럭 타임아웃 시 프로세스 트리 강제 종료.
static async Task<ExecResult> Exec(string file, string args, string cwd, string stdin, int timeoutMs)
{
    var psi = new ProcessStartInfo
    {
        FileName = file,
        Arguments = args,
        WorkingDirectory = cwd,
        RedirectStandardInput = true,
        RedirectStandardOutput = true,
        RedirectStandardError = true,
        UseShellExecute = false,
    };
    psi.Environment["DOTNET_CLI_TELEMETRY_OPTOUT"] = "1";
    psi.Environment["DOTNET_NOLOGO"] = "1";

    using var p = new Process { StartInfo = psi };
    var so = new StringBuilder();
    var se = new StringBuilder();
    p.OutputDataReceived += (_, e) => { if (e.Data != null) so.AppendLine(e.Data); };
    p.ErrorDataReceived += (_, e) => { if (e.Data != null) se.AppendLine(e.Data); };
    p.Start();
    p.BeginOutputReadLine();
    p.BeginErrorReadLine();

    try { if (stdin != null) { await p.StandardInput.WriteAsync(stdin); } p.StandardInput.Close(); } catch { }

    using var cts = new CancellationTokenSource(timeoutMs);
    var timedOut = false;
    try { await p.WaitForExitAsync(cts.Token); }
    catch (OperationCanceledException)
    {
        timedOut = true;
        try { p.Kill(entireProcessTree: true); } catch { }
        try { await p.WaitForExitAsync(); } catch { }
    }
    // 남은 비동기 출력 플러시
    try { p.WaitForExit(500); } catch { }
    return new ExecResult { exitCode = timedOut ? -1 : SafeExit(p), stdout = so.ToString(), stderr = se.ToString(), timedOut = timedOut };
}

static int SafeExit(Process p) { try { return p.ExitCode; } catch { return -1; } }

static string CsProjText(string tfm) =>
    "<Project Sdk=\"Microsoft.NET.Sdk\">\n" +
    "  <PropertyGroup>\n" +
    "    <OutputType>Exe</OutputType>\n" +
    $"    <TargetFramework>{tfm}</TargetFramework>\n" +
    "    <AssemblyName>app</AssemblyName>\n" +
    "    <ImplicitUsings>disable</ImplicitUsings>\n" +
    "    <Nullable>disable</Nullable>\n" +
    "    <InvariantGlobalization>true</InvariantGlobalization>\n" +
    "    <Deterministic>true</Deterministic>\n" +
    "  </PropertyGroup>\n" +
    "</Project>\n";

record RunReq { public string code { get; set; } public string stdin { get; set; } public int? runTimeoutMs { get; set; } }
class RunResp { public bool compileError { get; set; } public string compileOutput { get; set; } public string stdout { get; set; } public string stderr { get; set; } public bool timedOut { get; set; } public int exitCode { get; set; } }
struct ExecResult { public int exitCode; public string stdout; public string stderr; public bool timedOut; }
