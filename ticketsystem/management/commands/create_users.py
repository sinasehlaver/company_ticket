from django.core.management import CommandError
from django.core.management.base import BaseCommand
from django.contrib.auth import get_user_model
User = get_user_model()

class Command(BaseCommand):
    help = "Create a user, and allow password to be provided"
    requires_migrations_checks = True
  
    def add_arguments(self, parser):
        parser.add_argument(
            "--password",
            dest="password",
            default="companyticket22",
            help="Specifies the password for the users.",
        )
 
    def handle(self, *args, **options):
        password = options.get("password")
        
        user = User.objects.create_user(username='mimarlik', password=password)
        user.save()
        user = User.objects.create_user(username='kutuphane', password=password)
        user.save()
        user = User.objects.create_user(username='carsi', password=password)
        user.save()
        user = User.objects.create_user(username='hazirlik', password=password)
        user.save()
        user = User.objects.create_user(username='disari', password=password)
        user.save()
        return "Successfully created users"
