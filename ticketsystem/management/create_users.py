import django.contrib.auth
User = django.contrib.auth.get_user_model()
user = User.objects.create_user(username='mimarlik', password='companyticket22')
user.save()
user = User.objects.create_user(username='kutuphane', password='companyticket22')
user.save()
user = User.objects.create_user(username='carsi', password='companyticket22')
user.save()
user = User.objects.create_user(username='hazirlik', password='companyticket22')
user.save()
user = User.objects.create_user(username='disari', password='companyticket22')
user.save()