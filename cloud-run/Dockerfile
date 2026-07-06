# .NET SDK 이미지 — 런타임에 학생 코드를 dotnet build 해야 하므로 SDK가 필요.
FROM mcr.microsoft.com/dotnet/sdk:8.0

ENV DOTNET_CLI_TELEMETRY_OPTOUT=1 \
    DOTNET_NOLOGO=1 \
    DOTNET_SKIP_FIRST_TIME_EXPERIENCE=1 \
    ASPNETCORE_URLS=http://0.0.0.0:8080

WORKDIR /src
COPY Server.csproj .
RUN dotnet restore Server.csproj
COPY Program.cs .
RUN dotnet publish Server.csproj -c Release -o /app

# 학생 빌드 툴체인(NuGet/MSBuild 캐시) 워밍 — 첫 채점 지연 감소.
RUN mkdir -p /warm && cd /warm \
 && printf '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net8.0</TargetFramework></PropertyGroup></Project>' > w.csproj \
 && printf 'public class P{public static void Main(){System.Console.WriteLine(1);}}' > Program.cs \
 && dotnet build w.csproj -c Release -o out --nologo || true

WORKDIR /app
EXPOSE 8080
ENTRYPOINT ["dotnet", "Server.dll"]
